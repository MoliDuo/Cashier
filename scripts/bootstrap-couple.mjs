#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import { z } from "zod";
import { getCategoryPreset } from "../src/config/category-presets.ts";
import { loadLocalEnvironment } from "./load-local-environment.mjs";

const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw new Error("Unknown option");

function readConfig() {
  const parsed = z
    .object({
      url: z.string().startsWith("postgres"),
      ownerId: z.string().uuid(),
      partnerId: z.string().uuid(),
      ledgerId: z.string().uuid(),
      ownerEmail: z.email(),
      partnerEmail: z.email(),
      ownerPassword: z.string().min(8).max(128),
      partnerPassword: z.string().min(8).max(128),
    })
    .safeParse({
      url: process.env.DATABASE_URL,
      ownerId: process.env.COUPLE_OWNER_USER_ID,
      partnerId: process.env.COUPLE_PARTNER_USER_ID,
      ledgerId: process.env.COUPLE_LEDGER_ID,
      ownerEmail: process.env.COUPLE_OWNER_EMAIL?.trim().toLowerCase(),
      partnerEmail: process.env.COUPLE_PARTNER_EMAIL?.trim().toLowerCase(),
      ownerPassword: process.env.COUPLE_OWNER_PASSWORD,
      partnerPassword: process.env.COUPLE_PARTNER_PASSWORD,
    });
  if (!parsed.success) {
    throw new Error(
      `Invalid couple bootstrap configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }
  const config = parsed.data;
  if (config.ownerId === config.partnerId || config.ownerEmail === config.partnerEmail) {
    throw new Error("Members must have distinct IDs and email addresses");
  }
  for (const password of [config.ownerPassword, config.partnerPassword]) {
    if (!/(?=.*[A-Za-z])(?=.*\d)/.test(password) || bcrypt.truncates(password)) {
      throw new Error(
        "Member passwords must contain a letter and a number and fit in 72 UTF-8 bytes"
      );
    }
  }
  return config;
}

export async function main() {
  const config = readConfig();
  const client = new pg.Client({ connectionString: config.url });
  await client.connect();
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    if (apply) await client.query("SELECT pg_advisory_xact_lock($1)", [1129071779]);
    const {
      rows: [counts],
    } = await client.query(
      "SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM ledgers) AS ledgers"
    );
    if (counts.users !== 0 || counts.ledgers !== 0) {
      throw new Error("Couple bootstrap requires an empty user and ledger database");
    }
    const categories = getCategoryPreset("default", "zh");
    if (apply) {
      const now = new Date();
      // The two accounts start as A/male and B/female, the same defaults
      // migration 0047 gives existing rows. Both are renamed in 设置; nothing
      // here asks for a nickname, so a fresh database and an upgraded one
      // start from the same place.
      for (const [id, email, password, nickname, gender] of [
        [config.ownerId, config.ownerEmail, config.ownerPassword, "A", "male"],
        [config.partnerId, config.partnerEmail, config.partnerPassword, "B", "female"],
      ]) {
        await client.query(
          `INSERT INTO users (id, email, email_verified, password_hash, password_updated_at,
            nickname, gender, created_at, updated_at) VALUES ($1, $2, $3, $4, $3, $5, $6, $3, $3)`,
          [id, email, now, await bcrypt.hash(password, 12), nickname, gender]
        );
      }
      await client.query(
        `INSERT INTO ledgers (id, user_id, ai_language, preferred_currencies,
          main_currency, collapse_entries_default, ai_custom_prompt, created_at, updated_at)
         VALUES ($1, $2, 'zh-CN', ARRAY['CNY','USD'], 'CNY', false, '', $3, $3)`,
        [config.ledgerId, config.ownerId, now]
      );
      for (const [index, category] of categories.entries()) {
        await client.query(
          `INSERT INTO entry_categories (id, ledger_id, name, description, icon, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            randomUUID(),
            config.ledgerId,
            category.name,
            category.description,
            category.icon,
            index + 1,
            now,
          ]
        );
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "preview",
        users: 2,
        ledgers: 1,
        categories: categories.length,
      })
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnvironment();
  main().catch((error) => {
    console.error(`[bootstrap] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
