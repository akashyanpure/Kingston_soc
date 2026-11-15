/**
 * Binary storage (photos, PDFs, signature images) behind an interface so S3 can replace
 * the filesystem later. Keys are forward-slash paths like `photos/{visitId}/{id}.jpg`.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Stream for HTTP responses; null when missing. */
  stream(key: string): Promise<{ stream: Readable; size: number } | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export class FsStorage implements Storage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!KEY_RE.test(key) || key.split('/').some((s) => s === '..' || s === '.')) throw new Error(`Invalid storage key: ${key}`);
    const p = resolve(join(this.root, ...key.split('/')));
    if (!p.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return p;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p); // atomic replace
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async stream(key: string): Promise<{ stream: Readable; size: number } | null> {
    const p = this.path(key);
    try {
      const s = await stat(p);
      return { stream: createReadStream(p), size: s.size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Uint8Array) {
    this.files.set(key, Buffer.from(data));
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async stream(key: string) {
    const b = this.files.get(key);
    return b ? { stream: Readable.from([b]), size: b.length } : null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

export const photoKey = (visitId: string, photoId: string) => `photos/${visitId}/${photoId}.jpg`;
export const reportPdfKey = (visitId: string, reportNumber: string) => `reports/${visitId}/${reportNumber}.pdf`;
export const signatureKey = (reportId: string, signatureId: string) => `signatures/${reportId}/${signatureId}.png`;
