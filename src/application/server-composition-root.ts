import "server-only";
import { storedFileAdapter } from "@/application/adapters/storage";
import { postgresCategoryReclassificationJobAdapter } from "@/application/adapters/postgres/category-reclassification-jobs";
import { postgresCategoryAssignmentV2Adapter } from "@/application/adapters/postgres/category-assignment-v2";

/** Composition root for the PostgreSQL-backed runtime. */
export const serverComposition = {
  categoryReclassificationJobs: postgresCategoryReclassificationJobAdapter,
  categoryAssignments: postgresCategoryAssignmentV2Adapter,
  storedFiles: storedFileAdapter,
} as const;
