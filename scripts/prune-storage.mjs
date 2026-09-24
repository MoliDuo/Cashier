#!/usr/bin/env node
/**
 * Safe storage prune CLI.
 *
 * Defaults to dry-run: scans the database and object storage, reports a
 * per-category summary, and deletes nothing. Pass --apply to actually delete.
 *
 * Usage:
 *   npm run prune
 *   npm run prune -- --apply
 *   npm run prune -- --json --batch-size 500 --orphan-grace-days 14 --temporary-grace-hours 48
 *
 * Never touches soft-deleted source documents or their revisions.
 */

import { pathToFileURL } from "node:url";
import { loadLocalEnvironment } from "./load-local-environment.mjs";
import pg from "pg";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const PRUNE_ADVISORY_LOCK = 1_381_247_120;
const TEMPORARY_PREFIX = "temporary/";
const DURABLE_KEY_MARKER = "/stored/";
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    batchSize: 100,
    orphanGraceDays: 7,
    temporaryGraceHours: 24,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--batch-size") options.batchSize = Number(argv[++index]);
    else if (arg === "--orphan-grace-days") options.orphanGraceDays = Number(argv[++index]);
    else if (arg === "--temporary-grace-hours") options.temporaryGraceHours = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/prune-storage.mjs [options]",
          "",
          "Options:",
          "  --apply                       delete what the scan finds (default: dry-run)",
          "  --json                        print machine-readable JSON summary",
          "  --batch-size <n>              R2/DB batch size (default: 100)",
          "  --orphan-grace-days <n>       durable-object grace period (default: 7)",
          "  --temporary-grace-hours <n>   temporary-object grace period (default: 24)",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  if (!Number.isInteger(options.orphanGraceDays) || options.orphanGraceDays < 1) {
    throw new Error("--orphan-grace-days must be a positive integer");
  }
  if (!Number.isInteger(options.temporaryGraceHours) || options.temporaryGraceHours < 1) {
    throw new Error("--temporary-grace-hours must be a positive integer");
  }
  return options;
}

function emptyCounts() {
  return {
    count: 0,
    bytes: 0,
    deleted: 0,
    deletedBytes: 0,
    failed: 0,
    missing: 0,
    missingBytes: 0,
  };
}

function createS3Client() {
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

async function listObjectsPage(s3, bucket, prefix, continuationToken, maxKeys) {
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
      ...(continuationToken == null || continuationToken === ""
        ? {}
        : { ContinuationToken: continuationToken }),
    })
  );
  return {
    objects: (response.Contents ?? []).flatMap((object) =>
      object.Key == null || object.Key === ""
        ? []
        : [
            {
              key: object.Key,
              byteSize: object.Size ?? 0,
              lastModified: object.LastModified ?? null,
            },
          ]
    ),
    isTruncated: response.IsTruncated === true,
    nextContinuationToken: response.NextContinuationToken ?? null,
  };
}

async function objectExists(s3, bucket, key) {
  try {
    const response = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, byteSize: response.ContentLength ?? 0 };
  } catch (error) {
    const value = error;
    const isNotFound =
      value?.name === "NoSuchKey" ||
      value?.name === "NotFound" ||
      value?.$metadata?.httpStatusCode === 404;
    if (isNotFound) return { exists: false, byteSize: 0 };
    throw error;
  }
}

function parseTemporaryKey(key) {
  const parts = key.split("/");
  if (parts.length !== 4 || parts[0] !== "temporary") return null;
  return { ledgerId: parts[1], sessionId: parts[2], targetId: parts[3] };
}

async function loadValidTemporarySessions(client, pairs, now) {
  const uniqueIds = [...new Set(pairs.map((pair) => pair.sessionId))];
  if (uniqueIds.length === 0) return new Set();
  const result = await client.query(
    "SELECT id, status, expires_at FROM upload_sessions WHERE id = ANY($1::uuid[])",
    [uniqueIds]
  );
  const valid = new Set();
  for (const row of result.rows) {
    if (row.status === "finalizing") valid.add(row.id);
    if (row.status === "open" && new Date(row.expires_at).getTime() > now.getTime()) {
      valid.add(row.id);
    }
  }
  return valid;
}

export async function pruneExpiredRecords(client, now, batchSize, apply) {
  const counts = {
    rateLimitBuckets: 0,
    otpTokens: 0,
    idempotencyRecords: 0,
    uploadSessions: 0,
    objectCleanupJobs: 0,
  };

  if (apply) {
    const rateLimits = await client.query(
      `WITH doomed AS (
        SELECT bucket_key FROM rate_limit_buckets
        WHERE window_start < $1 LIMIT $2
      )
      DELETE FROM rate_limit_buckets USING doomed
      WHERE rate_limit_buckets.bucket_key = doomed.bucket_key`,
      [new Date(now.getTime() - 2 * DAY_MS), batchSize * 10]
    );
    counts.rateLimitBuckets = rateLimits.rowCount ?? 0;
  } else {
    const rateLimits = await client.query(
      "SELECT count(*)::int AS count FROM rate_limit_buckets WHERE window_start < $1",
      [new Date(now.getTime() - 2 * DAY_MS)]
    );
    counts.rateLimitBuckets = Number(rateLimits.rows[0]?.count ?? 0);
  }

  if (apply) {
    const otp = await client.query(
      "DELETE FROM otp_tokens WHERE id IN (SELECT id FROM otp_tokens WHERE expires < $1 LIMIT $2)",
      [now, batchSize * 10]
    );
    counts.otpTokens = otp.rowCount ?? 0;
  } else {
    const otp = await client.query(
      "SELECT count(*)::int AS count FROM otp_tokens WHERE expires < $1",
      [now]
    );
    counts.otpTokens = Number(otp.rows[0]?.count ?? 0);
  }

  if (apply) {
    const idempotency = await client.query(
      `DELETE FROM idempotency_records WHERE (principal_type, principal_id, key) IN (
        SELECT principal_type, principal_id, key FROM idempotency_records
        WHERE expires_at < $1 OR (status = 'completed' AND completed_at < $2)
        LIMIT $3
      )`,
      [now, new Date(now.getTime() - DAY_MS), batchSize * 10]
    );
    counts.idempotencyRecords = idempotency.rowCount ?? 0;
  } else {
    const idempotency = await client.query(
      `SELECT count(*)::int AS count FROM idempotency_records
       WHERE expires_at < $1 OR (status = 'completed' AND completed_at < $2)`,
      [now, new Date(now.getTime() - DAY_MS)]
    );
    counts.idempotencyRecords = Number(idempotency.rows[0]?.count ?? 0);
  }

  const staleSessions = await client.query(
    `SELECT id FROM upload_sessions
     WHERE (status IN ('expired', 'cancelled', 'finalized') OR expires_at < $1)
       AND created_at < $1
     LIMIT $2`,
    [new Date(now.getTime() - DAY_MS), batchSize * 10]
  );
  const sessionIds = staleSessions.rows.map((row) => row.id);
  if (sessionIds.length > 0 && apply) {
    // Cascade deletes the session's upload_session_files rows; the orphaned
    // temporary objects are removed by the temporary-object scan below.
    await client.query("DELETE FROM upload_sessions WHERE id = ANY($1::uuid[])", [sessionIds]);
  }
  counts.uploadSessions = sessionIds.length;

  if (apply) {
    const cleanupJobs = await client.query(
      `DELETE FROM object_cleanup_jobs WHERE id IN (
        SELECT id FROM object_cleanup_jobs
        WHERE (attempts >= 12 OR next_attempt_at < $1) AND created_at < $1
        LIMIT $2
      )`,
      [new Date(now.getTime() - 30 * DAY_MS), batchSize * 10]
    );
    counts.objectCleanupJobs = cleanupJobs.rowCount ?? 0;
  } else {
    const cleanupJobs = await client.query(
      `SELECT count(*)::int AS count FROM object_cleanup_jobs
       WHERE (attempts >= 12 OR next_attempt_at < $1) AND created_at < $1`,
      [new Date(now.getTime() - 30 * DAY_MS)]
    );
    counts.objectCleanupJobs = Number(cleanupJobs.rows[0]?.count ?? 0);
  }

  return counts;
}

export async function scanUnreferencedFiles(
  client,
  s3,
  bucket,
  fileCutoff,
  batchSize,
  apply,
  summary
) {
  let cursor = null;
  while (true) {
    const candidates = await client.query(
      `SELECT id, ledger_id, storage_key, byte_size, created_at
       FROM stored_files
       WHERE deleted_at IS NULL
         AND created_at < $1
         AND ($3::uuid IS NULL OR id > $3::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM revision_files rf
           WHERE rf.ledger_id = stored_files.ledger_id
             AND rf.stored_file_id = stored_files.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM upload_session_files usf
           JOIN upload_sessions us
             ON us.ledger_id = usf.ledger_id AND us.id = usf.upload_session_id
           WHERE usf.ledger_id = stored_files.ledger_id
             AND usf.stored_file_id = stored_files.id
             AND us.status IN ('open', 'finalizing')
         )
       ORDER BY id
       LIMIT $2`,
      [fileCutoff, batchSize, cursor]
    );
    if (candidates.rows.length === 0) break;

    for (const file of candidates.rows) {
      cursor = file.id;
      summary.unreferencedFiles.count += 1;
      summary.unreferencedFiles.bytes += Number(file.byte_size ?? 0);
      let head;
      try {
        head = await objectExists(s3, bucket, file.storage_key);
      } catch (error) {
        summary.unreferencedFiles.failed += 1;
        summary.errors.push(`head failed: ${file.storage_key}: ${error.message}`);
        continue;
      }
      if (!head.exists) {
        summary.unreferencedFiles.missing += 1;
        summary.unreferencedFiles.missingBytes += Number(file.byte_size ?? 0);
        summary.missingObjects.count += 1;
        summary.missingObjects.bytes += Number(file.byte_size ?? 0);
        continue;
      }
      if (!apply) continue;
      // Claim the row first: delete only while it is still unreferenced so a
      // concurrent submission cannot attach the file between the scan and the
      // external delete. A failed object delete afterwards leaves a durable
      // orphan that the next prune removes.
      try {
        const claimed = await client.query(
          `DELETE FROM stored_files
           WHERE id = $1
             AND storage_key = $2
             AND NOT EXISTS (
               SELECT 1 FROM revision_files rf
               WHERE rf.ledger_id = stored_files.ledger_id
                 AND rf.stored_file_id = stored_files.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM upload_session_files usf
               JOIN upload_sessions us
                 ON us.ledger_id = usf.ledger_id AND us.id = usf.upload_session_id
               WHERE usf.ledger_id = stored_files.ledger_id
                 AND usf.stored_file_id = stored_files.id
                 AND us.status IN ('open', 'finalizing')
             )
           RETURNING id`,
          [file.id, file.storage_key]
        );
        if ((claimed.rowCount ?? 0) === 0) {
          // The file became referenced (or vanished) concurrently — leave it.
          continue;
        }
      } catch (error) {
        summary.unreferencedFiles.failed += 1;
        summary.errors.push(`row claim failed: ${file.storage_key}: ${error.message}`);
        continue;
      }
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.storage_key }));
      } catch (error) {
        summary.unreferencedFiles.failed += 1;
        summary.errors.push(`delete failed after row claim: ${file.storage_key}: ${error.message}`);
        continue;
      }
      summary.unreferencedFiles.deleted += 1;
      summary.unreferencedFiles.deletedBytes += Number(file.byte_size ?? 0);
    }
  }
}

async function scanDurableOrphans(client, s3, bucket, fileCutoff, batchSize, apply, summary) {
  let continuationToken = null;
  do {
    const page = await listObjectsPage(s3, bucket, "", continuationToken, batchSize);
    const oldObjects = page.objects.filter(
      (object) =>
        object.key.includes(DURABLE_KEY_MARKER) &&
        !object.key.startsWith(TEMPORARY_PREFIX) &&
        object.lastModified != null &&
        object.lastModified <= fileCutoff
    );
    if (oldObjects.length > 0) {
      const keys = oldObjects.map((object) => object.key);
      const known = await client.query(
        "SELECT storage_key FROM stored_files WHERE storage_key = ANY($1::text[])",
        [keys]
      );
      const knownKeys = new Set(known.rows.map((row) => row.storage_key));
      for (const object of oldObjects) {
        if (knownKeys.has(object.key)) continue;
        summary.durableOrphans.count += 1;
        summary.durableOrphans.bytes += object.byteSize;
        if (!apply) continue;
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
          summary.durableOrphans.deleted += 1;
          summary.durableOrphans.deletedBytes += object.byteSize;
        } catch (error) {
          summary.durableOrphans.failed += 1;
          summary.errors.push(`durable orphan delete failed: ${object.key}: ${error.message}`);
        }
      }
    }
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken != null);
}

export async function scanTemporaryOrphans(
  client,
  s3,
  bucket,
  temporaryCutoff,
  now,
  batchSize,
  apply,
  summary
) {
  let continuationToken = null;
  do {
    const page = await listObjectsPage(s3, bucket, TEMPORARY_PREFIX, continuationToken, batchSize);
    const oldObjects = page.objects.filter(
      (object) => object.lastModified != null && object.lastModified <= temporaryCutoff
    );
    const parsedPairs = oldObjects.flatMap((object) => {
      const parsed = parseTemporaryKey(object.key);
      return parsed == null ? [] : [{ ...parsed, object }];
    });
    if (parsedPairs.length > 0) {
      const validSessions = await loadValidTemporarySessions(
        client,
        parsedPairs.map((pair) => ({ sessionId: pair.sessionId })),
        now
      );
      for (const pair of parsedPairs) {
        if (validSessions.has(pair.sessionId)) continue;
        summary.temporaryOrphans.count += 1;
        summary.temporaryOrphans.bytes += pair.object.byteSize;
        if (!apply) continue;
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: pair.object.key }));
          summary.temporaryOrphans.deleted += 1;
          summary.temporaryOrphans.deletedBytes += pair.object.byteSize;
        } catch (error) {
          summary.temporaryOrphans.failed += 1;
          summary.errors.push(
            `temporary orphan delete failed: ${pair.object.key}: ${error.message}`
          );
        }
      }
    }
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken != null);
}

export async function main() {
  loadLocalEnvironment();
  const options = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (connectionString == null || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  for (const key of [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]) {
    if (process.env[key] == null || process.env[key] === "") {
      throw new Error(`${key} must be set for storage prune`);
    }
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  const s3 = createS3Client();
  const bucket = process.env.S3_BUCKET;
  const now = new Date();
  const fileCutoff = new Date(now.getTime() - options.orphanGraceDays * DAY_MS);
  const temporaryCutoff = new Date(now.getTime() - options.temporaryGraceHours * 60 * 60 * 1000);
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    now: now.toISOString(),
    expiredRecords: null,
    unreferencedFiles: emptyCounts(),
    durableOrphans: emptyCounts(),
    temporaryOrphans: emptyCounts(),
    missingObjects: { count: 0, bytes: 0 },
    errors: [],
  };

  try {
    await client.query("SELECT pg_advisory_lock($1)", [PRUNE_ADVISORY_LOCK]);
    try {
      summary.expiredRecords = await pruneExpiredRecords(
        client,
        now,
        options.batchSize,
        options.apply
      );
      await scanUnreferencedFiles(
        client,
        s3,
        bucket,
        fileCutoff,
        options.batchSize,
        options.apply,
        summary
      );
      await scanDurableOrphans(
        client,
        s3,
        bucket,
        fileCutoff,
        options.batchSize,
        options.apply,
        summary
      );
      await scanTemporaryOrphans(
        client,
        s3,
        bucket,
        temporaryCutoff,
        now,
        options.batchSize,
        options.apply,
        summary
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [PRUNE_ADVISORY_LOCK]);
    }
  } finally {
    await client.end();
    s3.destroy();
  }

  if (options.json) {
    console.log(JSON.stringify(summary));
    return;
  }

  const fmt = (counts) =>
    `${counts.count} objects, ${counts.bytes} bytes` +
    (options.apply
      ? ` (deleted ${counts.deleted}, ${counts.deletedBytes} bytes; failed ${counts.failed}; missing ${counts.missing})`
      : ` (would delete ${counts.count}; missing ${counts.missing})`);
  console.log(`Prune mode: ${summary.mode}`);
  console.log(`Expired records: ${JSON.stringify(summary.expiredRecords)}`);
  console.log(`Unreferenced stored files: ${fmt(summary.unreferencedFiles)}`);
  console.log(`Durable orphans: ${fmt(summary.durableOrphans)}`);
  console.log(`Temporary orphans: ${fmt(summary.temporaryOrphans)}`);
  console.log(
    `Missing objects (reported only): ${summary.missingObjects.count}, ${summary.missingObjects.bytes} bytes`
  );
  if (summary.errors.length > 0) {
    console.error(`Errors (${summary.errors.length}):`);
    for (const error of summary.errors.slice(0, 50)) console.error(`  - ${error}`);
  }
  if (!options.apply) {
    console.log("Dry-run: no objects were deleted. Re-run with --apply to delete.");
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[prune] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
