// The site is plain HTML, so this test is the only thing that keeps twelve pages
// structurally consistent. No browser, no dependencies: it reads the files.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, assert } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..', 'site');
const pages = readdirSync(site).filter((file) => file.endsWith('.html')).sort();
const read = (file) => readFileSync(path.join(site, file), 'utf8');

test('every page has exactly one h1 and no skipped heading levels', () => {
  for (const file of pages) {
    const html = read(file);
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
    assert(levels.filter((level) => level === 1).length === 1, `${file}: expected one h1, found ${levels.filter((l) => l === 1).length}`);
    let previous = levels[0];
    for (const level of levels.slice(1)) {
      assert(level <= previous + 1, `${file}: heading jumps from h${previous} to h${level}`);
      previous = level;
    }
  }
});

test('the nav is identical on every page and every target exists', () => {
  const navs = pages.map((file) => {
    const nav = read(file).match(/<nav class="site"[\s\S]*?<\/nav>/)?.[0] ?? '';
    return nav.replace(/ aria-current="page"/g, '');
  });
  for (let index = 1; index < navs.length; index += 1) {
    assert(navs[index] === navs[0], `${pages[index]}: nav differs from ${pages[0]}`);
  }
  const hrefs = [...navs[0].matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert(hrefs.length === 12, `expected 12 nav links, found ${hrefs.length}`);
  for (const href of hrefs) assert(existsSync(path.join(site, href)), `nav target missing: ${href}`);
});

test('every local link, script and stylesheet resolves', () => {
  for (const file of pages) {
    const html = read(file);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = match[1];
      if (/^(https?:|mailto:|#|data:)/.test(reference)) continue;
      const target = path.join(site, reference.split(/[?#]/)[0]);
      assert(existsSync(target), `${file}: missing ${reference}`);
    }
  }
});

test('no warm accent literals survive in the site', () => {
  const forbidden = /f5a524|fb923c|facc15|3a2c12|1d1608|1a1408|f0d9a8|f472b6|e879f9|accent-2/i;
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(site)) {
    if (!/\.(css|js|html|svg)$/.test(file)) continue;
    assert(!forbidden.test(readFileSync(file, 'utf8')), `${path.relative(site, file)} still contains a retired colour`);
  }
});

test('every @font-face file exists and the font payload stays small', () => {
  const css = readFileSync(path.join(site, 'assets', 'style.css'), 'utf8');
  const files = [...css.matchAll(/url\("(assets\/fonts\/[^"]+\.woff2)"\)/g)].map((match) => match[1]);
  assert(files.length > 0, 'no font files declared');
  let bytes = 0;
  for (const file of files) {
    const full = path.join(site, file);
    assert(existsSync(full), `missing font: ${file}`);
    bytes += statSync(full).size;
  }
  assert(bytes < 200 * 1024, `font payload is ${Math.round(bytes / 1024)} KB, over the 200 KB budget`);
});

test('the share image is a PNG that exists', () => {
  for (const file of pages) {
    const html = read(file);
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? '';
    assert(image.endsWith('/og.png'), `${file}: og:image is not og.png`);
    assert(existsSync(path.join(site, 'og.png')), 'site/og.png is missing');
  }
});

test('every page has a skip link and a main landmark', () => {
  for (const file of pages) {
    const html = read(file);
    assert(/<a class="skip" href="#main">/.test(html), `${file}: no skip link`);
    assert(/<main[^>]*id="main"/.test(html), `${file}: main is not #main`);
  }
});
