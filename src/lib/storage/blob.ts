import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * BlobStore — provider-agnostic binary storage for Document AI. Local disk in
 * dev (a gitignored `.storage/`); swap for an S3/R2 implementation in prod
 * behind the same interface (the rest of the app only sees `storageKey`).
 */

const STORAGE_DIR = process.env.OPERANTO_STORAGE_DIR || ".storage";

export interface BlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalBlobStore implements BlobStore {
  private resolve(key: string): string {
    // Keys are server-generated; strip any traversal just in case.
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return join(STORAGE_DIR, safe);
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // already gone — fine
    }
  }
}

let store: BlobStore | null = null;
export function getBlobStore(): BlobStore {
  if (!store) store = new LocalBlobStore();
  return store;
}
