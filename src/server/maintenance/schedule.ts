import "server-only";
import { after } from "next/server";
import { runBoundedMaintenance } from "./run";
import { logger } from "@/lib/logger";

export function scheduleRequestMaintenance(): void {
  after(async () => {
    try {
      await runBoundedMaintenance();
    } catch (error) {
      logger.warn({ error }, "Bounded request maintenance failed");
    }
  });
}
