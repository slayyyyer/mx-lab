# ADR 0007 — Site redesign: one chrome, self-hosted type, a single accent

- **Status:** accepted
- **Date:** 2026-11-05
- **Related:** ADR 0006, `site/assets/style.css`, `scripts/chrome.js`

## Context

The site's presentation was functional but inconsistent: each page carried its own copy of the
header and footer, the brand was the `<h1>` on every page, headings skipped levels, and the palette
used a blue accent with amber for notes and chart series. The owner approved a design that uses a
single rose accent, a condensed display face and a shared page-head pattern.

Deployment is `site/` copied as-is by GitHub Pages, so the redesign could not introduce a build step.

## Decision

1. **The chrome is generated at development time, not at runtime.** `scripts/chrome.js` holds the
   header, skip link, nav and footer and rewrites them across `site/*.html`; `--check` fails when a
   page drifts. Runtime injection would blank the header without JavaScript and shift layout, and a
   deployment build step would break the "copy `site/`" pipeline. Page-specific method notes are
   preserved in a marked block, so regeneration never drops copy.
2. **Fonts are self-hosted.** Barlow Condensed, IBM Plex Sans and IBM Plex Mono are committed as
   Latin-subset woff2 files with their OFL licences, because third-party font requests contradict the
   project's no-external-dependency stance.
3. **One accent, and it is not a semantic colour.** `--accent` fills, borders, active indicators and
   large display text; `--accent-text` is the darker-for-contrast variant used for small text. Error
   red remains visibly distinct and is never the sole signal.
4. **Page heads carry the design; page content does not change.** Each analysis page gets an eyebrow,
   one `<h1>` with an accent tail, and its existing lede. Numbers, sections and page scripts are
   untouched.
5. **No claim is added for decoration.** Pills and coverage statements appear only where the data
   supports them; the mockup's placeholder findings and solver panel are not shipped.

## Consequences

- Adding a page means adding it to `NAV` and running the generator; the lint test fails if a nav
  target is missing or headings skip a level.
- The current pages are plain HTML that the generator can parse with regular expressions. If a page
  ever needs chrome the template cannot express, the generator needs a real editor rather than a
  larger regex.
