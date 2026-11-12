import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("ghostwriter suggestion persistence", () => {
  const originalEnv = { ...process.env };
  let scratch = "";
  let closeDb: (() => void) | undefined;
  beforeEach(async () => {
    vi.resetModules();
    scratch = await mkdtemp(join(process.cwd(), ".chat-repo-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: scratch,
      NODE_ENV: "test",
      JOB_OPS_APP_MODE: "self-hosted",
    };
    await import("../db/migrate");
    const database = await import("../db");
    closeDb = database.closeDb;
    await database.db.insert(database.schema.jobs).values({
      id: "job",
      source: "manual",
      title: "Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job",
    });
  });
  afterEach(async () => {
    closeDb?.();
    await rm(scratch, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });
  it("reads legacy, V2 and garbage rows through the decoder and retains tenant isolation", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const repo = await import("./ghostwriter");
    const { db } = await import("../db");
    const thread = await repo.createThread({ jobId: "job" });
    const legacy = {
      id: "old",
      reason: "r",
      op: "replace_bullet",
      experienceId: "exp",
      bulletIndex: 0,
      previousText: "Old",
      text: "New",
    };
    const current = {
      id: "new",
      reason: "r",
      op: "include_library_item" as const,
      libraryId: "library",
    };
    for (const [name, stored, expected] of [
      [
        "legacy",
        [legacy, { id: "lossy", reason: "r", op: "set_skills", skills: [] }],
        [
          {
            id: "old",
            reason: "r",
            op: "replace_bullet",
            section: "experience",
            itemId: "exp",
            bulletIndex: 0,
            previousText: "Old",
            text: "New",
          },
        ],
      ],
      ["v2", [current], [current]],
      ["garbage", [{ op: "unknown" }, null, "garbage"], []],
    ] as const) {
      const message = await repo.createMessage({
        jobId: "job",
        threadId: thread.id,
        role: "assistant",
        content: name,
      });
      // Simulate historical rows without asserting they satisfy the current write contract.
      db.run(
        sql`UPDATE job_chat_messages SET suggestions = ${JSON.stringify(stored)} WHERE id = ${message.id}`,
      );
      expect((await repo.getMessageById(message.id))?.suggestions).toEqual(
        expected,
      );
      expect(
        await runWithRequestContext({ tenantId: "other-tenant" }, () =>
          repo.getMessageById(message.id),
        ),
      ).toBeNull();
    }
    const message = await repo.createMessage({
      jobId: "job",
      threadId: thread.id,
      role: "assistant",
      content: "new",
    });
    expect(
      (await repo.updateMessage(message.id, { suggestions: [current] }))
        ?.suggestions,
    ).toEqual([current]);
  });
});
