import type { spawn } from "node:child_process";

const MAX_STDERR_LINES = 40;

export async function runCliProcess(args: {
  spawnFn: typeof spawn;
  command: string;
  argv: string[];
  shell: boolean;
  stdin: { mode: "ignore" } | { mode: "pipe"; input: string | undefined };
  timeoutMs: number;
  signal?: AbortSignal;
  label: "Claude CLI" | "Gemini CLI";
}): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const stderrLines: string[] = [];
    const stdoutChunks: Buffer[] = [];
    let settled = false;

    const child = args.spawnFn(args.command, args.argv, {
      stdio: [args.stdin.mode, "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
      shell: args.shell,
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (args.signal) {
      if (args.signal.aborted) {
        onAbort();
      } else {
        args.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        stderrLines.push(t);
        if (stderrLines.length > MAX_STDERR_LINES) {
          stderrLines.shift();
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => {
        reject(new Error(`${args.label} timed out after ${args.timeoutMs}ms.`));
      });
    }, args.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(() => {
        reject(error);
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish(() => {
        if (args.signal?.aborted) {
          reject(new Error(`${args.label} invocation was aborted.`));
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
        const stderr = stderrLines.join(" | ");
        if (code !== 0) {
          reject(
            new Error(stderr || stdout || `${args.label} exited with code ${code ?? "unknown"}.`),
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    if (args.stdin.mode === "pipe" && child.stdin) {
      child.stdin.on("error", (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
      child.stdin.end(args.stdin.input);
    }
  });
}
