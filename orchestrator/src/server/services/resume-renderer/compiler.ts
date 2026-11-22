import { spawn } from "node:child_process";
import { logger } from "@infra/logger";

export async function runResumeCompiler(args: {
  binary: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  jobId: string;
  label: "Tectonic" | "Typst";
  missingBinaryMessage: string;
  warningMessage: string;
  truncateOutput: (value: string) => string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(args.binary, args.argv, {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `${args.label} timed out after ${args.timeoutMs / 1000}s while rendering resume PDF.`,
        ),
      );
    }, args.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(args.missingBinaryMessage));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${args.label} failed with exit code ${code ?? "unknown"}. ${args.truncateOutput(stderr || stdout)}`,
        ),
      );
    });
  }).catch((error) => {
    logger.warn(args.warningMessage, {
      jobId: args.jobId,
      error,
      compiler: args.binary,
    });
    throw error;
  });
}
