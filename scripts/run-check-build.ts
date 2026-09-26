import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createTestEnvironment } from "./test-environment";

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export async function runCheckBuild({
  environment = process.env,
  spawnProcess = spawn,
}: { environment?: NodeJS.ProcessEnv; spawnProcess?: SpawnProcess } = {}): Promise<number> {
  const child = spawnProcess(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    env: createTestEnvironment(environment, { NODE_ENV: "production" }),
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT") resolve(130);
      else if (signal === "SIGTERM") resolve(143);
      else resolve(code ?? 1);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCheckBuild()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
