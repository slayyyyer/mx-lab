// PDF text extraction.
//
// The extractor is part of the contract: fixtures are extracted text, so a
// different build of pdftotext is a different input. The machine that verified
// the sources has an xpdf `pdftotext` on PATH that lacks some poppler output
// behaviour, so resolution order is explicit and the chosen binary can be
// overridden with PDFTOTEXT.

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const LOCAL_POPPLER = path.resolve('.tools/poppler-26.09.0/Library/bin/pdftotext.exe');

export async function resolvePdftotext() {
  const candidates = [process.env.PDFTOTEXT, LOCAL_POPPLER].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  // Fall back to PATH (CI installs poppler-utils). `--version` is checked by the caller.
  return 'pdftotext';
}

export async function pdftotextVersion() {
  const bin = await resolvePdftotext();
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ['-v']);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').split('\n')[0].trim()));
  });
}

/** Extract text preserving horizontal layout, UTF-8 (names like Lidköping need it). */
export async function pdfToText(pdfPath, { layout = true } = {}) {
  const bin = await resolvePdftotext();
  const args = [...(layout ? ['-layout'] : []), '-enc', 'UTF-8', pdfPath, '-'];
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (cause) => reject(new Error(`could not run ${bin}: ${cause.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`pdftotext exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`));
    });
  });
}
