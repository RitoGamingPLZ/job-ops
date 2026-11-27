import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  ellipsis: string;
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
          `${args.label} failed with exit code ${code ?? "unknown"}. ${truncateCompilerOutput(stderr || stdout, args.ellipsis)}`,
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

function truncateCompilerOutput(value: string, ellipsis: string): string {
  const trimmed = value.trim();
  const limit = 1200;
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}${ellipsis}(truncated ${trimmed.length - limit} chars)`;
}

export async function withRenderTempDir(
  args: { renderer: "LaTeX" | "Typst"; jobId: string; prefix: string },
  render: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), args.prefix));
  try {
    await render(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch((error) => {
      logger.warn(`Failed to cleanup temporary ${args.renderer} render directory`, {
        jobId: args.jobId,
        tempDir,
        error,
      });
    });
  }
}
