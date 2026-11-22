import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getDataDir } from "@server/config/dataDir";

export interface BlobObject {
  key: string;
  body: Uint8Array;
  contentType?: string | null;
  size: number;
}

export interface BlobListEntry {
  key: string;
  size: number;
  uploadedAt?: Date;
}

export interface BlobPutOptions {
  contentType?: string | null;
}

export interface BlobListOptions {
  prefix?: string;
}

export interface BlobStore {
  get(key: string): Promise<BlobObject | null>;
  put(
    key: string,
    data: Uint8Array | Buffer | ArrayBuffer | string,
    options?: BlobPutOptions,
  ): Promise<{ key: string; size: number }>;
  delete(key: string): Promise<void>;
  list(options?: BlobListOptions): Promise<BlobListEntry[]>;
  exists(key: string): Promise<boolean>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded?: Date;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2ObjectsLike {
  objects: Array<{ key: string; size: number; uploaded?: Date }>;
  truncated: boolean;
  cursor?: string;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<R2ObjectsLike>;
  head(key: string): Promise<{ key: string; size: number } | null>;
}

function normalizeBlobKey(key: string): string {
  const normalized = key
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!normalized) {
    throw new Error("Blob key must not be empty");
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`Invalid blob key: ${key}`);
  }
  return normalized;
}

function normalizeBlobPrefix(prefix?: string): string {
  if (!prefix) return "";
  return prefix.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function toUint8Array(
  data: Uint8Array | Buffer | ArrayBuffer | string,
): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return data;
}

function isEnoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Filesystem-backed BlobStore rooted at `getDataDir()` (or an explicit directory).
 */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly baseDir?: string) {}

  private getBaseDir(): string {
    return resolve(this.baseDir ?? getDataDir());
  }

  private resolveKeyPath(key: string): {
    normalizedKey: string;
    fullPath: string;
  } {
    const normalizedKey = normalizeBlobKey(key);
    const rootDir = this.getBaseDir();
    const fullPath = resolve(rootDir, ...normalizedKey.split("/"));
    if (fullPath !== rootDir && !fullPath.startsWith(`${rootDir}${sep}`)) {
      throw new Error(`Blob key escapes base directory: ${key}`);
    }
    return { normalizedKey, fullPath };
  }

  async get(key: string): Promise<BlobObject | null> {
    const { normalizedKey, fullPath } = this.resolveKeyPath(key);
    try {
      const buffer = await readFile(fullPath);
      const body = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
      return {
        key: normalizedKey,
        body,
        size: body.byteLength,
      };
    } catch (error) {
      if (isEnoentError(error)) return null;
      throw error;
    }
  }

  async put(
    key: string,
    data: Uint8Array | Buffer | ArrayBuffer | string,
    _options?: BlobPutOptions,
  ): Promise<{ key: string; size: number }> {
    const { normalizedKey, fullPath } = this.resolveKeyPath(key);
    const bytes = toUint8Array(data);
    const dir = dirname(fullPath);
    const tempPath = join(dir, `.${randomUUID()}.tmp`);

    await mkdir(dir, { recursive: true });
    try {
      await writeFile(tempPath, bytes);
      await rename(tempPath, fullPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      key: normalizedKey,
      size: bytes.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const { fullPath } = this.resolveKeyPath(key);
    await rm(fullPath, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const { fullPath } = this.resolveKeyPath(key);
    try {
      await access(fullPath);
      return true;
    } catch (error) {
      if (isEnoentError(error)) return false;
      throw error;
    }
  }

  async list(options?: BlobListOptions): Promise<BlobListEntry[]> {
    const rootDir = this.getBaseDir();
    const prefix = normalizeBlobPrefix(options?.prefix);
    const entries: BlobListEntry[] = [];

    const walk = async (dirPath: string): Promise<void> => {
      let dirEntries: Dirent[];
      try {
        dirEntries = await readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        if (isEnoentError(error)) return;
        throw error;
      }

      for (const entry of dirEntries) {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;

        const key = relative(rootDir, entryPath).split(sep).join("/");
        if (prefix && !key.startsWith(prefix)) continue;

        const fileStat = await stat(entryPath);
        entries.push({
          key,
          size: fileStat.size,
          uploadedAt: fileStat.mtime,
        });
      }
    };

    await walk(rootDir);
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }
}

/**
 * Cloudflare R2-backed BlobStore adapter.
 */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async get(key: string): Promise<BlobObject | null> {
    const normalizedKey = normalizeBlobKey(key);
    const obj = await this.bucket.get(normalizedKey);
    if (!obj) return null;

    const buffer = await obj.arrayBuffer();
    const body = new Uint8Array(buffer);
    return {
      key: obj.key,
      body,
      contentType: obj.httpMetadata?.contentType ?? null,
      size: obj.size,
    };
  }

  async put(
    key: string,
    data: Uint8Array | Buffer | ArrayBuffer | string,
    options?: BlobPutOptions,
  ): Promise<{ key: string; size: number }> {
    const normalizedKey = normalizeBlobKey(key);
    const bytes = toUint8Array(data);
    await this.bucket.put(
      normalizedKey,
      bytes,
      options?.contentType
        ? { httpMetadata: { contentType: options.contentType } }
        : undefined,
    );
    return {
      key: normalizedKey,
      size: bytes.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const normalizedKey = normalizeBlobKey(key);
    await this.bucket.delete(normalizedKey);
  }

  async exists(key: string): Promise<boolean> {
    const normalizedKey = normalizeBlobKey(key);
    const head = await this.bucket.head(normalizedKey);
    return head !== null;
  }

  async list(options?: BlobListOptions): Promise<BlobListEntry[]> {
    const prefix = normalizeBlobPrefix(options?.prefix);
    const results: BlobListEntry[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.bucket.list({
        ...(prefix ? { prefix } : {}),
        ...(cursor ? { cursor } : {}),
      });
      for (const obj of page.objects) {
        results.push({
          key: obj.key,
          size: obj.size,
          uploadedAt: obj.uploaded,
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    results.sort((a, b) => a.key.localeCompare(b.key));
    return results;
  }
}

const defaultLocalBlobStore = new LocalBlobStore();
let activeBlobStore: BlobStore = defaultLocalBlobStore;

/**
 * Returns the active BlobStore (defaulting to LocalBlobStore backed by getDataDir()).
 */
export function getBlobStore(): BlobStore {
  return activeBlobStore;
}

/**
 * Overrides the active BlobStore (e.g. R2BlobStore in Cloudflare Workers or mocks in tests).
 * Pass null to restore the default LocalBlobStore.
 */
export function setBlobStore(store: BlobStore | null): void {
  activeBlobStore = store ?? defaultLocalBlobStore;
}
