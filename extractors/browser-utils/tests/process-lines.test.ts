import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { subscribeChildProcessLines } from "../src/process-lines.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("subscribeChildProcessLines", () => {
  it("routes lines to the matching parent stream until closed", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: Array<[string, NodeJS.WriteStream]> = [];
    const close = subscribeChildProcessLines({ stdout, stderr } as never, (line, stream) =>
      lines.push([line, stream]),
    );

    stdout.write("a\nb\n");
    stderr.write("err\n");
    await tick();
    close();
    stdout.write("late\n");
    await tick();

    expect(lines).toEqual([
      ["a", process.stdout],
      ["b", process.stdout],
      ["err", process.stderr],
    ]);
  });

  it("tolerates missing pipes", () => {
    const close = subscribeChildProcessLines({ stdout: null, stderr: null }, () => {});
    expect(close).not.toThrow();
  });
});
