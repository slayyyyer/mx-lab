// Fetching, with the two rules the handoff set: identify with the repo URL only,
// and never ship the fetched artefact — only its hash.
//
// Every fetch is cached under cache/ (git-ignored) so a build can be re-run
// offline, and so parsers can be re-developed without re-hitting the source.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const USER_AGENT = 'mx-lab/0.1 (+https://github.com/slayyyyer/mx-lab)';

const CACHE_DIR = path.resolve('cache/http');

function cacheKey(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @returns {Promise<{bytes: Buffer, meta: {url: string, sha256: string, bytes: number}}>}
 */
export async function fetchBytes(url, { offline = false } = {}) {
  const key = cacheKey(url);
  const binPath = path.join(CACHE_DIR, `${key}.bin`);
  const metaPath = path.join(CACHE_DIR, `${key}.json`);

  if (offline) {
    const bytes = await readFile(binPath);
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    return { bytes, meta };
  }

  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const meta = {
    url,
    sha256: sha256(bytes),
    bytes: bytes.length,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(binPath, bytes);
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { bytes, meta };
}

/** Fetches a PDF and writes it under cache/pdf/ so the extractor can read it from disk. */
export async function fetchPdf(url, { offline = false } = {}) {
  const { bytes, meta } = await fetchBytes(url, { offline });
  const dir = path.resolve('cache/pdf');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${meta.sha256.slice(0, 16)}.pdf`);
  await writeFile(file, bytes);
  return { path: file, meta };
}
