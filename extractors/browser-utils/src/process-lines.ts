import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Forwards each stdout/stderr line of a child process to `onLine`, paired with
 * the matching parent stream. Returns a function that closes both readers.
 */
export function subscribeChildProcessLines(
  child: Pick<ChildProcess, "stdout" | "stderr">,
  onLine: (line: string, stream: NodeJS.WriteStream) => void,
): () => void {
  const stdoutRl = child.stdout ? createInterface({ input: child.stdout }) : null;
  const stderrRl = child.stderr ? createInterface({ input: child.stderr }) : null;

  stdoutRl?.on("line", (line) => onLine(line, process.stdout));
  stderrRl?.on("line", (line) => onLine(line, process.stderr));

  return () => {
    stdoutRl?.close();
    stderrRl?.close();
  };
}
