#!/usr/bin/env node
// One header and footer for all twelve pages.
//
// Deployment stays a plain copy of site/, so this runs by hand after adding a
// page: `node scripts/chrome.js` rewrites the chrome, `--check` fails when a page
// has drifted. Page-specific method notes that used to sit in the footer are
// lifted into a marked block, so regenerating never deletes copy.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'site');

const NAV = [
  ['index.html', 'Overview'],
  ['lap-chart.html', 'Lap chart'],
  ['fade.html', 'Fade'],
  ['lap-one.html', 'Lap 1'],
  ['qualifying.html', 'Qualifying'],
  ['titles.html', 'Titles'],
  ['ratings.html', 'Ratings'],
  ['riders.html', 'Riders'],
  ['tracks.html', 'Tracks'],
  ['methods.html', 'Methods'],
  ['backtests.html', 'Backtests'],
  ['coverage.html', 'Coverage'],
];

// Page head: eyebrow, then the H1 with its accent tail.
const HEADS = {
  'lap-chart.html': ['6.1 · Lap chart', 'Where everyone <span class="accent">actually was.</span>'],
  'fade.html': ['6.2 · Fade', 'Who holds pace, <span class="accent">who fades.</span>'],
  'lap-one.html': ['6.3 · Lap 1', 'What lap one <span class="accent">is worth.</span>'],
  'qualifying.html': ['6.4 · Qualifying', 'What qualifying <span class="accent">is worth.</span>'],
  'titles.html': ['6.5 · Titles', 'The championship, <span class="accent">computed.</span>'],
  'ratings.html': ['6.6 · Ratings', 'A rating per rider, <span class="accent">by class.</span>'],
  'riders.html': ['Riders', 'Every rider, <span class="accent">every moto.</span>'],
  'tracks.html': ['Tracks', 'Every track, <span class="accent">measured.</span>'],
  'methods.html': ['Methods', 'How it is <span class="accent">measured.</span>'],
  'backtests.html': ['Backtests', 'Do the models <span class="accent">beat the baseline?</span>'],
  'coverage.html': ['Coverage', 'What is covered, <span class="accent">and what is not.</span>'],
};

const header = (current) => `<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <div class="wrap header-inner">
    <p class="brandmark"><a href="index.html">MX<span class="dot">·</span>LAB</a></p>
    <nav class="site" aria-label="Sections">
${NAV.map(([href, label]) => `      <a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('\n')}
    </nav>
  </div>
</header>`;

const footer = (method) => `<footer class="site">
  <div class="wrap">
    <p>
      <strong>Unofficial.</strong> This project is not affiliated with or endorsed by AMA Pro Racing,
      MX Sports, Pro Motocross, or any series, team or rider. Series names appear in plain text only;
      no logos or marks are used. Results are attributed to their timing and scoring providers:
      the AMA results archive (<span class="mono">americanmotocrossresults.com</span>) for 2020–2024 and
      the LiveTime results sites (<span class="mono">results.promotocross.com</span> for Motocross and
      <span class="mono">results.supercrosslive.com</span> for Supercross) for 2025–2026.
    </p>${method ? `\n    <!-- chrome:method -->\n    ${method}\n    <!-- /chrome:method -->` : ''}
    <p class="small">
      Derived statistics only: no source PDFs or mirrored pages are stored or served here. Source code
      and the dataset live at <a href="https://github.com/slayyyyer/mx-lab">github.com/slayyyyer/mx-lab</a>.
    </p>
    <p class="small footer-links">
      <a href="https://slayyyyer.github.io/">Portfolio</a><span>·</span><a href="https://github.com/slayyyyer/mx-lab">GitHub</a>
    </p>
  </div>
</footer>`;

const preloads = `<link rel="preload" href="assets/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css">`;

// Returns the preserved method markup (a <p>, not its inner text), so a second
// run does not wrap an already-wrapped paragraph in another one.
function methodOf(html) {
  const marked = html.match(/<!-- chrome:method -->([\s\S]*?)<!-- \/chrome:method -->/);
  if (marked) return marked[1].trim();
  const old = html.match(/<footer class="site">[\s\S]*?<\/footer>/)?.[0] ?? '';
  const paragraphs = [...old.matchAll(/<p class="small">([\s\S]*?)<\/p>/g)]
    .map((match) => match[0].trim())
    .filter((text) => !/^<p class="small">Derived statistics only/.test(text));
  return paragraphs.join('\n');
}

export function transform(source, file) {
  let html = source;
  const method = methodOf(html);

  html = html.replace(/<a class="skip"[\s\S]*?<\/a>\n?/, '');
  html = html.replace(/<header class="site">[\s\S]*?<\/header>/, header(file));
  html = html.replace(/<main class="wrap">/, '<main class="wrap" id="main">');

  const head = HEADS[file];
  const hadH1 = /<h1[\s>]/.test(html);
  if (head && !hadH1) {
    const [eyebrow, title] = head;
    const h2Count = (html.match(/<h2[\s>]/g) ?? []).length;
    html = html.replace(/<h2>[^<]*<\/h2>/, `<p class="eyebrow">${eyebrow}</p>\n  <h1>${title}</h1>`);
    // The old page title was the only h2; promote its sections and demote cards.
    if (h2Count === 1) {
      html = html
        .replace(/<h3([\s>])/g, '<h2$1')
        .replace(/<\/h3>/g, '</h2>')
        .replace(/<h4([\s>])/g, '<h3$1')
        .replace(/<\/h4>/g, '</h3>');
    }
  }

  html = html.replace(/<footer class="site">[\s\S]*?<\/footer>/, footer(method));
  html = html.replace(/https:\/\/slayyyyer\.github\.io\/mx-lab\/og\.svg/g, 'https://slayyyyer.github.io/mx-lab/og.png');

  if (!html.includes('rel="preload"')) {
    html = html.replace('<link rel="stylesheet" href="assets/style.css">', preloads);
  }
  return html;
}

const check = process.argv.includes('--check');
const files = fs.readdirSync(SITE).filter((file) => file.endsWith('.html')).sort();
let drifted = 0;

for (const file of files) {
  const target = path.join(SITE, file);
  const source = fs.readFileSync(target, 'utf8');
  const result = transform(source, file);
  if (result === source) continue;
  drifted += 1;
  if (check) {
    console.error(`drift  site/${file}`);
  } else {
    fs.writeFileSync(target, result);
    console.log(`wrote  site/${file}`);
  }
}

if (check) {
  if (drifted) {
    console.error(`\n${drifted} page(s) differ from the chrome template. Run: node scripts/chrome.js`);
    process.exit(1);
  }
  console.log(`chrome: ${files.length}/${files.length} pages match`);
} else {
  console.log(`chrome: ${drifted} page(s) updated`);
}
