import "server-only";
import { storedFileAdapter } from "@/application/adapters/storage";

/** Composition root for the PostgreSQL-backed runtime. */
export const serverComposition = {
  storedFiles: storedFileAdapter,
} as const;
