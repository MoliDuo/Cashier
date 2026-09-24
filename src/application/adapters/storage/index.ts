import type { DirectStoredFilePort } from "@/application/contracts";
import { createAuthorizedFileReadOperations } from "./stored-files/authorized-file-reads";
import { createUploadPlanOperations } from "./stored-files/upload-plans";
import { createProxyUploadOperations } from "./stored-files/proxy-uploads";
import { createUploadFinalizationOperations } from "./stored-files/upload-finalization";
import {
  resolveStoredFileAdapterDependencies,
  type StoredFileAdapterDependencies,
} from "./stored-files/shared";

export type StoredFileAdapter = DirectStoredFilePort &
  ReturnType<typeof createUploadPlanOperations> &
  ReturnType<typeof createProxyUploadOperations> &
  ReturnType<typeof createUploadFinalizationOperations> &
  ReturnType<typeof createAuthorizedFileReadOperations>;

export function createStoredFileAdapter(
  dependencies: StoredFileAdapterDependencies = {}
): StoredFileAdapter {
  const resolved = resolveStoredFileAdapterDependencies(dependencies);
  return {
    ...createUploadPlanOperations(resolved),
    ...createProxyUploadOperations(resolved),
    ...createUploadFinalizationOperations(resolved),
    ...createAuthorizedFileReadOperations(resolved),
  };
}

export const storedFileAdapter = createStoredFileAdapter();
