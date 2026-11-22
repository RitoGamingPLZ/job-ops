import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithRequestContext } from "@infra/request-context";
import {
  removeStoredJobDocument,
  removeStoredJobDocuments,
  storeJobDocument,
} from "@server/services/job-document-storage";
import {
  getLegacyJobPdfKey,
  getTenantJobPdfKey,
  readStoredJobPdf,
  removeStoredJobPdf,
  storedJobPdfExists,
  writeStoredJobPdf,
} from "@server/services/pdf-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBlobStore,
  LocalBlobStore,
  R2BlobStore,
  type R2BucketLike,
  setBlobStore,
} from "./blob-store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

function createInMemoryR2Bucket(pageSize = 2): R2BucketLike {
  const objects = new Map<
    string,
    { body: Uint8Array; contentType?: string; uploaded: Date }
  >();

  return {
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.body.byteLength,
        uploaded: entry.uploaded,
        httpMetadata: entry.contentType
          ? { contentType: entry.contentType }
          : undefined,
        async arrayBuffer() {
          return entry.body.slice().buffer;
        },
      };
    },
    async put(key, value, options) {
      const body =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value);
      objects.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      });
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        objects.delete(key);
      }
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const matching = Array.from(objects.entries())
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const offset = options?.cursor ? Number(options.cursor) : 0;
      const slice = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      const truncated = nextOffset < matching.length;
      return {
        objects: slice.map(([key, entry]) => ({
          key,
          size: entry.body.byteLength,
          uploaded: entry.uploaded,
        })),
        truncated,
        cursor: truncated ? String(nextOffset) : undefined,
      };
    },
    async head(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return { key, size: entry.body.byteLength };
    },
  };
}

describe("BlobStore", () => {
  let tempDir = "";
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-blob-"));
    process.env.DATA_DIR = tempDir;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    setBlobStore(null);
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  describe("LocalBlobStore", () => {
    it("puts, gets, checks existence, lists, and deletes blobs", async () => {
      const store = new LocalBlobStore(tempDir);

      expect(await store.exists("pdfs/t1/resume_1.pdf")).toBe(false);
      expect(await store.get("pdfs/t1/resume_1.pdf")).toBeNull();

      const putResult = await store.put("pdfs/t1/resume_1.pdf", "hello-pdf");
      expect(putResult).toEqual({ key: "pdfs/t1/resume_1.pdf", size: 9 });
      expect(await store.exists("pdfs/t1/resume_1.pdf")).toBe(true);

      const fetched = await store.get("pdfs/t1/resume_1.pdf");
      expect(fetched).not.toBeNull();
      expect(new TextDecoder().decode(fetched?.body)).toBe("hello-pdf");
      expect(fetched?.size).toBe(9);

      await store.put(
        "job-documents/t1/j1/a.txt",
        new Uint8Array([1, 2, 3, 4]),
      );
      await store.put("job-documents/t1/j2/b.txt", Buffer.from("abc"));

      const all = await store.list();
      expect(all.map((entry) => entry.key)).toEqual([
        "job-documents/t1/j1/a.txt",
        "job-documents/t1/j2/b.txt",
        "pdfs/t1/resume_1.pdf",
      ]);

      const filtered = await store.list({ prefix: "job-documents/t1/j1/" });
      expect(filtered.map((entry) => entry.key)).toEqual([
        "job-documents/t1/j1/a.txt",
      ]);

      await store.delete("pdfs/t1/resume_1.pdf");
      expect(await store.exists("pdfs/t1/resume_1.pdf")).toBe(false);
      await expect(
        store.delete("pdfs/t1/missing.pdf"),
      ).resolves.toBeUndefined();
    });

    it("rejects empty or path-traversal keys", async () => {
      const store = new LocalBlobStore(tempDir);
      await expect(store.put("", "data")).rejects.toThrow();
      await expect(store.get("../secret.txt")).rejects.toThrow();
      await expect(store.delete("a/../b")).rejects.toThrow();
    });

    it("only walks the prefix directory and preserves partial filename matching", async () => {
      const store = new LocalBlobStore(tempDir);
      await store.put("pdfs/t1/resume_1.pdf", "one");
      await store.put("pdfs/t1/nested/resume_2.pdf", "two");
      await store.put("pdfs/t2/resume_3.pdf", "other tenant");
      await store.put("other/unrelated.txt", "unrelated");

      const listed = await store.list({ prefix: "pdfs/t1/" });
      expect(listed.map((entry) => entry.key)).toEqual([
        "pdfs/t1/nested/resume_2.pdf",
        "pdfs/t1/resume_1.pdf",
      ]);
      expect(vi.mocked(readdir).mock.calls.map(([path]) => path)).toEqual([
        join(tempDir, "pdfs/t1"),
        join(tempDir, "pdfs/t1/nested"),
      ]);

      expect(
        (await store.list({ prefix: "pdfs/t1/resume_" })).map(
          (entry) => entry.key,
        ),
      ).toEqual(["pdfs/t1/resume_1.pdf"]);
      expect(await store.list({ prefix: "missing/tenant/" })).toEqual([]);
      await expect(store.list({ prefix: "../outside/" })).rejects.toThrow();
    });

    it("returns no blobs for dot or non-directory prefixes while rejecting traversal", async () => {
      const store = new LocalBlobStore(tempDir);
      await store.put("pdfs/t1/resume_1.pdf", "one");
      await store.put("pdfs/t2/resume_2.pdf", "other tenant");

      for (const prefix of [
        "./pdfs/",
        "pdfs/./t1/",
        "missing/tenant/",
        "pdfs/t1/resume_1.pdf/",
        "pdfs/t1/resume_1.pdf/nested/",
      ]) {
        await expect(store.list({ prefix })).resolves.toEqual([]);
      }
      await expect(store.list({ prefix: "./pdfs/t1/../t2/" })).rejects.toThrow(
        "Invalid blob key",
      );
    });
  });

  describe("R2BlobStore", () => {
    it("puts, gets with contentType, checks existence, paginates list, and deletes", async () => {
      const bucket = createInMemoryR2Bucket(2);
      const store = new R2BlobStore(bucket);

      await store.put("docs/1.txt", "one", { contentType: "text/plain" });
      await store.put("docs/2.txt", "two", { contentType: "text/plain" });
      await store.put("docs/3.txt", "three", { contentType: "text/plain" });
      await store.put("other/4.txt", "four");

      expect(await store.exists("docs/2.txt")).toBe(true);
      expect(await store.exists("docs/99.txt")).toBe(false);

      const obj = await store.get("docs/3.txt");
      expect(obj).not.toBeNull();
      expect(obj?.contentType).toBe("text/plain");
      expect(new TextDecoder().decode(obj?.body)).toBe("three");

      const listedDocs = await store.list({ prefix: "docs/" });
      expect(listedDocs.map((entry) => entry.key)).toEqual([
        "docs/1.txt",
        "docs/2.txt",
        "docs/3.txt",
      ]);

      await store.delete("docs/2.txt");
      expect(await store.exists("docs/2.txt")).toBe(false);
    });
  });

  describe("getBlobStore / setBlobStore", () => {
    it("allows swapping the active BlobStore and resetting to LocalBlobStore", () => {
      const initial = getBlobStore();
      expect(initial).toBeInstanceOf(LocalBlobStore);

      const r2Store = new R2BlobStore(createInMemoryR2Bucket());
      setBlobStore(r2Store);
      expect(getBlobStore()).toBe(r2Store);

      setBlobStore(null);
      expect(getBlobStore()).toBe(initial);
    });
  });

  describe("storage service wiring", () => {
    it("deletes the legacy PDF without touching another tenant's PDF", async () => {
      const store = new LocalBlobStore(tempDir);
      setBlobStore(store);
      const jobId = "legacy-delete";
      await runWithRequestContext({ tenantId: "t2" }, () =>
        writeStoredJobPdf(jobId, Buffer.from("other tenant")),
      );
      await store.put(getLegacyJobPdfKey(jobId), "legacy");

      await runWithRequestContext({ tenantId: "t1" }, async () => {
        await store.put(getTenantJobPdfKey(jobId), "current");
        await removeStoredJobPdf(jobId);
        expect(await storedJobPdfExists(jobId)).toBe(false);
        expect(await readStoredJobPdf(jobId)).toBeNull();
      });
      expect(await store.exists(getLegacyJobPdfKey(jobId))).toBe(false);
      await runWithRequestContext({ tenantId: "t2" }, async () => {
        expect(await storedJobPdfExists(jobId)).toBe(true);
      });
    });

    it("removes the legacy PDF after replacement without touching another tenant", async () => {
      const store = new R2BlobStore(createInMemoryR2Bucket(10));
      setBlobStore(store);
      const jobId = "legacy-replace";
      await runWithRequestContext({ tenantId: "t2" }, () =>
        writeStoredJobPdf(jobId, Buffer.from("other tenant")),
      );
      await store.put(getLegacyJobPdfKey(jobId), "legacy");

      await runWithRequestContext({ tenantId: "t1" }, async () => {
        await writeStoredJobPdf(jobId, Buffer.from("replacement"));
        expect(await store.exists(getLegacyJobPdfKey(jobId))).toBe(false);
        await store.delete(getTenantJobPdfKey(jobId));
        expect(await readStoredJobPdf(jobId)).toBeNull();
      });
      await runWithRequestContext({ tenantId: "t2" }, async () => {
        expect(
          new TextDecoder().decode(
            (await readStoredJobPdf(jobId)) ?? undefined,
          ),
        ).toBe("other tenant");
      });
    });

    it("keeps the legacy PDF when saving its replacement fails", async () => {
      const store = new LocalBlobStore(tempDir);
      setBlobStore(store);
      const jobId = "failed-replacement";
      await store.put(getLegacyJobPdfKey(jobId), "legacy");
      vi.spyOn(store, "put").mockRejectedValueOnce(new Error("write failed"));

      await expect(
        writeStoredJobPdf(jobId, Buffer.from("replacement")),
      ).rejects.toThrow("write failed");
      expect(await store.exists(getLegacyJobPdfKey(jobId))).toBe(true);
    });

    it("routes pdf-storage and job-document-storage through the active BlobStore", async () => {
      const r2Store = new R2BlobStore(createInMemoryR2Bucket(10));
      setBlobStore(r2Store);

      await writeStoredJobPdf("job-123", Buffer.from("%PDF-1.4\n"));
      expect(await storedJobPdfExists("job-123")).toBe(true);
      const pdfBytes = await readStoredJobPdf("job-123");
      expect(new TextDecoder().decode(pdfBytes ?? new Uint8Array())).toBe(
        "%PDF-1.4\n",
      );
      await removeStoredJobPdf("job-123");
      expect(await storedJobPdfExists("job-123")).toBe(false);

      const doc1 = await storeJobDocument({
        jobId: "job-456",
        fileName: "offer.txt",
        mediaType: "text/plain",
        dataBase64: Buffer.from("hello offer").toString("base64"),
      });
      const doc2 = await storeJobDocument({
        jobId: "job-456",
        fileName: "notes.txt",
        mediaType: "text/plain",
        dataBase64: Buffer.from("hello notes").toString("base64"),
      });

      const listedBefore = await r2Store.list({ prefix: "job-documents/" });
      expect(listedBefore).toHaveLength(2);

      await removeStoredJobDocument(doc1.storagePath);
      expect(await r2Store.list({ prefix: "job-documents/" })).toHaveLength(1);

      await removeStoredJobDocuments("job-456");
      expect(await r2Store.list({ prefix: "job-documents/" })).toHaveLength(0);
      expect(doc2.byteSize).toBe(11);
    });
  });
});
