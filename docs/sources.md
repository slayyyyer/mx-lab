# Sources

Status: **verified 2026-11-04**, first pass. Every claim below was checked against the live
site on that date with a descriptive `User-Agent`; where a claim in the handoff turned out to be
wrong or incomplete, it is marked **CORRECTION**.

Scope: AMA Pro Motocross (outdoor), 450MX and 250MX. Supercross out of scope for v1.

---

## 1. Decisions (summary)

| Question | Decision |
|---|---|
| Structured results data? | **No.** The XML next to the PDFs is a *file manifest*, not result values (see §4). Results must be parsed from PDF. |
| Primary base URL | `https://americanmotocrossresults.com` — canonical string to store in the manifest. |
| Mirror | `https://live.amaproracing.com` serves **byte-identical** files (§2). Fetch from one host only; never both. |
| Extraction tool | `pdftotext -layout -enc UTF-8`. Coordinate output (`-bbox-layout`) is needed for the lap chart (§7.2) and must be validated in CI — see the toolchain caveat below. |
| Seasons in v1 | **2020–2024** (55 events, all verified reachable). 2025 and 2026 are **not in this archive** (see §9 — CORRECTION). |
| Raw PDFs | Never committed. Cache in Actions; commit manifest (URL, fetched_at, sha256, parser_id, ETag). |

---

## 2. Hosts, and how many of them there really are

The archive is one IIS 10 backend reachable under several names:

| Host | Role | Evidence |
|---|---|---|
| `americanmotocrossresults.com` | Serves the full PDF archive | `GET /xml/MX/events/M2405SchedRes.xml` → 200, 11 557 B |
| `live.amaproracing.com` | Same tree under `/live/archives/mx/` | Same URL path → 200, 11 557 B, **identical sha256** `92e820be…87ea0` |
| `results.amaproracing.com` | Navigation portal only, links out; **no files** | Index HTML has no `/xml/` or `/pdf/` links |
| `americanmotocrosslive.com` | Legacy live-timing front end | Linked from archive pages; robots.txt 404 |

**Practical consequence:** treat `americanmotocrossresults.com` as the single origin. Because the
two hosts are the same bytes, a "changed file" check against the mirror would be a false signal;
pick one and keep it in the manifest.

---

## 3. Discovery: how to enumerate events

There is **no XML/JSON event index** (`/xml/MX/events.xml` and `/xml/MX/2024/events.xml` both 404).
Event IDs must be read out of HTML.

Two generations of index page exist:

**(a) Legacy listing — server-rendered, 2004–2020**

```
https://americanmotocrossresults.com/events.html            # 108 events
→ /live/archives/mx/<year>/<round>-<track>/index.shtml
```

- Years present: 2004–2013, 2015–2020. **2014 is absent** from the listing.
- This is the only index that is plain server-rendered HTML, so it is the reliable crawl root
  for the old seasons.

**(b) Modern listing — 2021–2024**

```
https://americanmotocrossresults.com/<year>/index.html?EventID=<EID>
```

- e.g. `…/2024/index.html?EventID=M2405`.
- The page renders client-side: `/javascript/web/results/a.js` reads the `EventID` query param and
  fetches `<series>/events/<EID>SchedRes.xml`.
- `/live/archives/mx/2021/` … `/2023/` return 200 but contain no event links; the event list for
  these years is **not published as static HTML anywhere we found**.

**Event ID format:** `M<YY><NN>`, where `YY` is the season (e.g. `24`) and `NN` increments by
**5** per round starting at `05` (`M2405` = 2024 round 1). Verified rounds:

| Season | Event IDs | Rounds |
|---|---|---|
| 2020 | `M2005` … `M2045` | 9 |
| 2021 | `M2105` … `M2160` | 12 |
| 2022 | `M2205` … `M2260` | 12 |
| 2023 | `M2305` … `M2355` | 11 |
| 2024 | `M2405` … `M2455` | 11 |

**Consequence for the scraper:** stride-5 probing is a *workaround*, not a contract. The ingest job
must (i) probe the range for the season, (ii) take the round number and date from the `SchedRes.xml`
metadata, not from the ID, and (iii) treat a gap in the sequence as a hard error rather than
silently shortening the season. Round numbering must come from the archive, never from the ID.

---

## 4. The "structured XML": what it actually contains

`/xml/MX/events/<EID>SchedRes.xml` (≈11.5 KB) is the manifest the results pages render from.

Structure:

```xml
<A>
  <B E="Fox Raceway National" T="Fox Raceway at Pala" L="Pala, CA"
     SANC="M2405" D="May 25, 2024" TLW="…svg" SCHD="1" SUPP="0" TMAP="1" TLOG="1">
    <C D="Saturday, May 25, 2024">
      <F T="1:01PM" S="250 Class Sight Lap/ Top 5 Rider Introduction" CLS="ZZ" … />
      <F T="2:05PM" S="450MX Moto 1" CLS="MX1" L="/xml/MX/events/M2405/M1F1RES.pdf" … />
    </C>
  </B>
</A>
```

- `<B>`: event name `E`, track `T`, location `L`, sanction/event id `SANC`, date `D`.
- `<C>`: a day, with `D` = date string.
- `<F>`: a session, with `T` start time, `S` session name, `CLS` class code, and — once a sheet is
  published — `L` = path to the PDF.

**It contains links and schedule only. There are no lap times, positions or points anywhere in the
XML.** The handoff's hope that `xml/…` meant structured results is therefore **not** borne out: the
`xml/` prefix is a directory name holding PDFs. Result values still require PDF parsing.

What it *is* good for, and why it still matters:

1. Authoritative event metadata (name, track, location, date, round day list).
2. Authoritative **which sheets exist** for an event — i.e. the ingest work list, instead of
   guessing filenames.
3. Publication detection: an `L` attribute appearing for a session is a clean "results are up" signal.

---

## 5. File inventory (verified sheet types)

All under `/xml/MX/events/<EID>/<FILE>.pdf`. Every file type below was opened and extracted on
2026-11-04. `M1F1…` naming: the segment before `F` selects the session block, the `F`/`Q`/`L`
letter the session kind — **do not rely on the letter meaning; read the sheet's own title line**
(see §7.1).

| Code | Sheet title (from PDF) | Fields observed | Used for |
|---|---|---|---|
| `M1F1RES` | `PROVISIONAL RESULTS - 450MX MOTO #1 (30 MINUTES + 2 LAPS)` | POS, #, RIDER, HOMETOWN, BIKE, INTERVAL, BEST TIME, TEAM/SPONSORS, `15 Laps` | `moto_results` |
| `M1F1IND` | `INDIVIDUAL SEGMENT TIMES - 450MX MOTO #1` | per lap: LAP, SEG1–SEG5, SPEED, LAPTIME; `AVG` and `IDEAL` rows; **two riders per page in side-by-side blocks**, so a page must be split by x before rows are read | `laps` |
| `M1F1LAP` | `LAP CHART - 450MX MOTO #1` | grid of **position per lap** per rider; legend `Indicates Lapped Rider` | `laps.position`, lap chart |
| `M1Q1OVR` | `BEST LAP TIMES - 450MX GROUP A QUALIFYING 1` | POS, BEST TIME, IN LAP, 2nd BEST, IN LAP | `qualifying` |
| `M1Q1IND` / `M1Q1SEG` / `M1Q1RID` | per-lap / segment / rider detail for that qualifying session | as above | cross-checks |
| `M1F1SEG` | segment (sector) times | sector splits | optional |
| `M1F1LINEUP` | starting lineup | grid order | optional |
| `M1F2POINTS`, `M1F2POINTSPOSITION` | championship points after the moto | points, position | standings cross-check |
| `M0F2MANUFACTURERPOINTS` | manufacturer points | make, points | out of scope |
| `M1F1PRESS`, `M1F1RID` | press/notes, rider notes | prose | out of scope |
| `X1F2SMXPOINTS`, `X2F2SMXPOINTS` | SuperMotocross combined points | points | out of scope (SMX ≠ outdoor MX) |

Notes:

- **`PROVISIONAL RESULTS`** — the results sheets are labelled provisional. We record the sheet's
  own wording; there is no separate "official" file in the archive to wait for. If a file is
  replaced later (it happens), `Last-Modified` + sha256 catch it and the event is re-parsed.
- Qualifying is split by **group** (A/B) and session number, so a rider appears in several
  `Q*OVR` sheets. The `qualifying` table must key on `(event, class, rider, session)`, and any
  "best qualifying lap" must be a min over that rider's sessions, with the session recorded.
- `M1`/`M2` blocks contain sheets for **both** classes (`F1`, `F2`); the class of a sheet comes
  from its title, not from the code.

---

## 6. Coverage and update timing

- Coverage: **2020-05-… through 2024-08-24** (final 2024 round, Ironman, `M2455`). 55 events.
- `Last-Modified` and `ETag` are served (IIS). Example: `M1F1RES.pdf` for `M2405` →
  `Last-Modified: Sat, 25 May 2024 21:55:39 GMT` (≈4 h after the moto). No `Cache-Control`.
- **Update timing:** sheets appear during/after each moto on race day; the 2024 round-1 result sheet
  was stamped 21:55 UTC on the race date. Ingest therefore runs *the day after* a race, and a
  same-day poll is not needed. A second, later re-check is worth doing once (T+2 days) to catch
  corrected sheets; that is what the manifest hash comparison is for.
- Conditional requests are supported and must be used (`If-None-Match` with the stored `ETag`).

---

## 7. Format and parsing hazards (all observed, not theoretical)

### 7.1 Sheet codes do not reliably denote class

`M1F1RES` is 450MX Moto 1 and `M1F2RES` is 250MX Moto 1 for `M2405`, but the same letters are
reused across blocks. Parse the **title line** (`<CLASS> MOTO #<N>` / `<CLASS> GROUP <G>
QUALIFYING <N>`) and assert it matches the requested sheet. A parser that trusts the filename
will mislabel a whole moto, which is exactly the kind of error the validation gate exists to catch.

### 7.2 Lap charts do not survive `pdftotext -layout` naively

Real output (2024 `M1F1LAP`):

```
#7 - A. Plessinger     2      7  7      7  7  7   7  7   7  96 96 233 60 87 103 416
#12 - S. McElrath      3 96 96 96 96 96 96 96 96            7 332 171 96 96 96 296
```

Position values above the field size (`96`, `233`, `416` — those are *plate numbers*) leak into the
same visual row. The grid is being flattened and columns bleed. Consequences:

- **Do not** tokenise these lines by whitespace and assume token *k* is lap *k*.
- **Different extraction modes disagree with each other**, which proves plain text cannot resolve
  the grid. For the same page, `-table` puts the run of `7`s on **C. Sexton**:

  ```
  #4 - C. Sexton      2  7  7  7  7  7  7  7  7  96  96  233  60  87  103  416
  #7 - A. Plessinger  3  96 96 96 96 96 96 96 96  7   332 171   96  96   96  296
  ```

  while `-layout` puts the same run of `7`s on **A. Plessinger** and leaves `C. Sexton` empty.
  One of them is wrong, and neither mode tells you which. Row assignment is genuinely ambiguous in
  flattened text: the name rows and the digit rows are offset from each other.
- The header is also split — `1 … 15` sits in the left column group and `16 17 18 19 20` far to the
  right — so there is at least one unused column group on the page whose role is *not yet
  explained*. Do not assume a 15-lap chart has 20 usable columns.
- Parse by **x coordinate**, not token order: assign each cell to a lap column by its x position,
  then to a rider row by its y position. This needs per-word boxes, which Poppler's
  `pdftotext -bbox-layout` provides.
- **Toolchain caveat (verified locally, 2026-11-04):** the `pdftotext` on this machine is
  **xpdf 4.06**, not Poppler, and it *rejects* `-bbox-layout` (it offers `-layout`, `-table`,
  `-simple`, `-lineprinter` and no coordinate output). So coordinate parsing cannot be proven
  locally as-is: install Poppler locally, or confirm `-bbox-layout` in CI before writing the
  lap-chart parser. Until then the coordinate path is a design decision, not a tested one.
- **Status of each sheet type:** `RES` and `IND` extract cleanly enough from `-layout` (verified);
  `LAP` does not, and is the one sheet whose parser is genuinely unresolved. Because `IND` has no
  position column at all (§7.7), this is the critical path for analyses 6.1, 6.2 and 6.3.
- Lapped riders are marked graphically (legend: `Indicates Lapped Rider`), so "position" for a
  lapped rider is not comparable to a rider on the lead lap. This is a real modelling decision, not
  a parsing detail — see §7.5.

### 7.3 Layout drifts across years

2020 lap chart (`M2005`) uses wider column spacing and leaves cells blank; 2022/2024 are tighter and
fill more cells. 2020 header reads `LAP CHART - 450MX MOTO 1`, 2024 reads `LAP CHART - 450MX MOTO #1
(30 MINUTES + 2 LAPS)`. Different layout ⇒ different parser version, selected by a layout
fingerprint (title line + column geometry), with unknown layouts **refused**, per the handoff.

### 7.4 Results rows wrap, so the name column is not always populated

2022 `M1F1RES` extraction:

```
  1   23 Chase Sexton      La Moille, IL         HON CRF450R WE    16 Laps    2:16.306
  2                                              HON CRF450R WE    +15.877    2:17.019
  3   94 Ken Roczen        Germany               YAM YZ 450F       +31.206    2:17.960
  4                                              KAW KX450SR       +38.211    2:18.177
```

Rows 2 and 4 have no name/plate: long "TEAM/SPONSORS" strings push the name onto a wrapped line.
A row-wise parser must reassemble by y-coordinate and by carrying the POS column, not by regex on
"looks like a name". This is the single most likely source of a silently wrong rider identity.

### 7.5 Lap 1 has no time for some riders

Confirmed, e.g. `M2405` `M1F1IND`, rider #11 K. Chisholm: lap 1 = `--.---`, laps 2… = real times.
This is the handoff's observed oddity, and it is real. It means lap-1 **time** is missing for part
of the field while lap-1 **position** (from the lap chart) may still exist. Analysis 6.3 must state
which of the two it uses.

**2020 is the extreme case, found while building analysis 6.3: the whole season has no lap-1 time.**
All 1,400 result rows carry `--.---` for lap 1, so the lap-1 analysis starts at 2021 and reports each
season's coverage beside its correlation. It is not a parser failure — the same extractor recovers
lap 1 from 2021 onward — and no value is invented to fill the gap.

### 7.6 Encoding

Default extraction mangles names: `Lidk?ping` → `Lidköping` with `-enc UTF-8`. Always pass `-enc
UTF-8`; store UTF-8 NFC.

### 7.7 Positions are in the lap chart, not in the lap-times sheet

`M1F1IND` has no position column at all — its header is `LAP SEG1 SEG2 SEG3 SEG4 SEG5 SPEED
LAPTIME`. So the handoff's "derive positions from cumulative elapsed time" is a **fallback** for
events whose lap chart is missing or unparseable, plus an independent check. The primary source of
per-lap position is `M1F1LAP`, and the two must agree before an event is accepted. (The 2024
sample did not "lack a position column" — it lacked one in the *wrong sheet*.)

---

## 8. robots.txt and terms

| Host | `robots.txt` | Result |
|---|---|---|
| `americanmotocrossresults.com` | 404 | no rules declared |
| `live.amaproracing.com` | 404 | no rules declared |
| `results.amaproracing.com` | 404 | no rules declared |
| `americanmotocrosslive.com` | 404 | no rules declared |
| `www.amaproracing.com` | 404 | no rules declared |
| `promotocross.com` | 200 | rules exist; not a v1 source |

- `results.amaproracing.com` links only to `https://www.amaproracing.com/about/` and
  `…/competitors/contact`. **There is no terms-of-use or data-licence page on the results hosts.**
- So: **no explicit prohibition, and no explicit permission.** That is a weaker footing than a
  permissive licence. The plan below is deliberately conservative and stays inside "public facts,
  derived statistics, link back":
  - no raw PDFs in the repo or on the site;
  - no logo, no site mirroring, no bulk crawl beyond the sheets actually used;
  - attribute the timing and scoring provider and link to the source page for every event;
  - publish derived statistics only.
- **Open item for Justin:** if a licence/prohibition surfaces (e.g. in the series rulebook or in a
  reply to a contact enquiry), stop and re-assess rather than working around it.

---

## 9. What is *not* available (CORRECTIONS to the handoff)

1. **No 2025 or 2026 data in this archive.** `/live/archives/mx/2025/` and `/2026/` → 404;
   `M2505`, `M2501`, `M2601` → 404. The last event is `M2455` (Ironman, 2024-08-23/24).
   The handoff's premise that "the 2026 season appears complete, so the first run ingests all of
   it" is **false for this source**. The AMA site also states that its legacy PDF archive "will no
   longer update". Consequence: v1 covers **2020–2024 (5 full seasons, 55 events)**, which exceeds
   the "at least three full seasons" acceptance bar. Adding 2025–2026 requires a different source
   (promotocross.com's results database) and a separate ADR — not a silent extension.
2. **No structured result values.** See §4.
3. **No round number in the XML metadata.** Round must be derived from the season's ordered event
   list (or the `ROUND n OF m` line on the RES sheet, which does carry it — e.g.
   `ROUND 1 OF 11 - MAY 25, 2024`). Prefer the sheet's own line, and cross-check against position
   in the season list.
4. **No 2014 in the legacy index**, and 2004–2019 formats are older still (out of v1 scope).

---

## 10. Client behaviour rules (binding on the scraper)

- `User-Agent`: `mx-lab/<version> (+https://github.com/slayyyyer/mx-lab; contact: TBD)` — the
  contact is an open item for Justin (§11).
- Conditional GETs with stored `ETag`/`Last-Modified`; a 304 is a success and must not rewrite the
  manifest.
- One fetch per file per run; no re-fetch of an unchanged event.
- Exponential backoff with jitter on 5xx/timeouts; honour `Retry-After`; cap total requests per run.
- Never parallel-hammer: a small concurrency limit (≤2) against a single IIS origin.
- Raw PDFs cached only in the Actions cache / local `cache/` (git-ignored).

---

## 11. Open questions for Justin

1. Contact string for the `User-Agent` (email or GitHub handle only?).
2. Confirm v1 = 2020–2024, with 2025–2026 as a separate follow-up against promotocross.com.
3. This machine has **no Node** installed, so nothing can be run locally yet. A `pdftotext` *is*
   present at `/ucrt64/bin/pdftotext`, but it is **xpdf 4.06**, not Poppler, and lacks
   `-bbox-layout` (§7.2). Install Node 20 for the build/test harness, and decide whether to also
   install Poppler locally (recommended: keeps the local and CI extractors identical, which is
   worth a lot for a parser whose fixtures come from extraction output).
4. Create/push the public `slayyyyer/mx-lab` repo now, or keep everything local until the pipeline
   works?

**Answered 2026-11-04:** (1) UA carries the repo URL only, no email. (2) Scope is **2020–2026**: the
AMA PDF archive for 2020–2024 plus promotocross for 2025–2026 (§12). (3) Node and Poppler are
installed locally (§13). (4) Repo to be initialised and pushed.

---

## 12. Second source for 2025–2026: `results.promotocross.com`

Needed because the AMA PDF archive stops at 2024 (§9).

**What it is:** a separate, older application — `Pro Motocross Championship :: Archived Results` —
built on the **LiveTime Scoring Engine**. Its own config reports `trackInfo.account_id = 7478`,
`software_edition = "MX"`, `domain = livemx.com`, `public_email = support@livetimescoring.com`,
`last_sync_time = 2026-10-23 18:27:12`, `last_sync_event_id = 518988`. So it is the timing
provider's own product, not a third-party scraper site.

**URL pattern:**

```
https://results.promotocross.com/results/?p=<report>&id=<event_id>[&class_id=<id>][&race_id=<id>][&rt=<n>]
https://results.promotocross.com/events/            # years 2022–2026 present
```

**Report types that actually exist** (enumerated from the pages, not guessed):

| `p=` | Report | Notes |
|---|---|---|
| `view_event` | event hub | links every report for the event |
| `box_score_report` | `250/450 BOX SCORE REPORT — OVERALL RESULTS` | **server-rendered HTML**; columns `POS, #, BIKE, RIDER, QUAL, M1, M2, LAPS LED, FINISH, POINTS` |
| `view_race_result` | single race result | needs `id` + `race_id` |
| `view_heat_sheet` | qualifying/race lineup sheet | needs `id` + `race_id`; text-only, no times found |
| `view_combined_round_ranking` | overall for the round | needs `class_id` + `rt` |
| `view_entry_list` | entry list | |
| `view_series_points` | points standings | |
| `view_multi_main_result` | multi-moto results | |

- Every report has an **HTML and a PDF form** (`&export=pdf`), and the HTML is server-rendered, so
  this source needs no PDF parsing at all for results.
- **robots.txt is permissive for our paths:** it disallows only `/account/reset-password`,
  `/content-send/*`, `/comments/*`, `/cdn-cgi*`. Results and events pages are allowed.
- Parameters are **mandatory and easy to get wrong**: the same `p=` value returns 404 without the
  right `id`/`class_id`/`race_id`, so discovery must read links out of `view_event` rather than
  construct URLs.

**Open question — per-lap data.** No lap-time strings were found in the box score or heat sheet, and
this source appears to carry **results and points only**. That matters: analyses 6.1 (lap chart),
6.2 (fade) and 6.3 (lap-1 value) need per-lap times and per-lap positions, which the 2025–2026
source may not provide. If it does not, those three analyses cover 2020–2024 only, and 2025–2026
contribute to 6.4 (qualifying), 6.5 (title maths) and 6.6 (ratings). That split must be stated on
the site rather than papered over.

---

## 13. Local toolchain (installed 2026-11-04, per Justin's approval)

| Tool | Where | Version | Note |
|---|---|---|---|
| Node | `…/WinGet/Packages/OpenJS.NodeJS.LTS_…/node-v24.20.0-win-x64/` | **24.20.0** (npm 11.19.0) | winget's LTS channel now ships 24. CI **pins Node 20**; code must stay 20-compatible. Not on `PATH` in this shell — invoke by absolute path or a project wrapper. |
| Poppler | `.tools/poppler-26.09.0/Library/bin/pdftotext.exe` | 26.09.0 | Has `-bbox-layout`. Git-ignored. |
| xpdf `pdftotext` | `/ucrt64/bin/pdftotext` | 4.06 | Pre-existing. **No `-bbox-layout`.** Never use for the lap chart. |

The extraction step must use an explicit Poppler path. Two `pdftotext` binaries now exist on this
machine, and silently picking the xpdf one would change parser input — and therefore fixtures —
without any error.

---

## 14. Corrections and findings from building the parser (2026-11-04)

Building `src/` against real sheets corrected three claims made earlier in this
document and added four new source hazards. Recorded here rather than silently
edited, because the earlier reasoning is what led to each mistake.

### 14.1 §7.2 is wrong about the lap chart: it does not carry positions

§7.2 said the lap chart needs coordinates to be parsed. It does need coordinates
— but coordinates do not make it a position source, because **the grid does not
contain positions**. Rendering `M2405/M1F1LAP.pdf` page 1 shows rows labelled
`#<plate> - <initial>. <Surname>` and cells holding **plate numbers**:

```
#4 - C. Sexton    2   7   7   7   7   7   7   96   96  [233]  [60]  [87]  [103]  [416]
```

`96`, `233`, `416` are plates, not positions, and the bracketed cells are the
`Indicates Lapped Rider` marker (boxed in the PDF). The leftmost numeric column
(`1…39`) is a row sequence number, not a lap-1 position: rows are sorted by
plate, not by position.

Consequence: **per-lap positions are not available for 2020–2024.** They cannot
be recovered from cumulative lap times either, because lap 1 has no time, so
sums from lap 2 onward give relative gaps rather than track position. This is a
scope limit for analyses 6.1–6.3 and is carried into ADR 0003.

### 14.2 The usable per-lap sheet is `RID`, not `IND`

`M1F1IND` (Individual Segment Times) lays out two riders per page in
independently-positioned blocks: one rider's name sits at the same y as the
other's lap rows, and the summary block shifts vertically per rider. `M1F1RID`
(Individual Lap Times) is a clean 10-column grid of per-lap times with
`MIN`/`MAX`/`AVG` rows, and parses from `-layout` text alone. The pipeline uses
`RID`; `IND` is not used.

Hazards found in `RID`:

- The fastest lap is struck through in print, and the summary block **shifts up**
  for a rider with fewer printed laps, so its `MIN` cell lands on the line where
  other columns still show a lap. A cell whose first token is `MIN`/`MAX`/`AVG`
  is a summary, never a lap number.
- Capability check: `M2405` 450 Moto 1 has 20 riders with 15 lap rows and 18
  with 14, plus the DNF with none. The 18 are not a parse failure; the sheet
  simply has no final lap for them (see 14.3).

### 14.3 The sheets often omit the final lap

At Pala, 18 of 40 riders in 450 Moto 1 have 14 lap times for a 15-lap moto, and
the missing one is the last. Anything built on per-lap times must handle a
truncated final lap instead of assuming `count == laps completed`.

### 14.4 A results row can wrap onto a continuation line

`M2405/M2F1RES.pdf`, position 40 (`#108 Jorgen-Matthias Talviku`): the name ends
the row line and the hometown, bike and `DNF` continue on the next line. The
parser reassembles a row from its continuation only when the interval field is
missing, and otherwise refuses the layout.

### 14.5 The results sheet has a second table on a later page

After the results table, page 2 carries a `LAP # / LAP LEADER` table whose rows
also begin `pos  plate`. The row scan is therefore bounded at the session-notes
block (`SESSION NOTES`, `Humidity:`, `RACE TIME:`), and the position field is
then required to be contiguous `1..n` — which is what catches a silently
dropped row.

### 14.6 Qualifying lists every entrant and is printed in two parts

`M1QCOVR` at Pala has **71 rows** for a 40-rider moto: it is the whole entry
list, not the field. It is split across two pages by a `TOP 36 RIDERS QUALIFY`
separator, so a parser that stops at the first non-row line silently loses 35
rows. The qualifying position is the entry-list position; the moto lineup is a
different, later artefact (`LINEUP` sheet).

### 14.7 2025–2026 per-lap data does exist

§12 recorded that no lap-time strings were found on `results.promotocross.com`.
That was wrong, and the cause was constructing report URLs by hand: the same
`p=` value 404s without the parameters the site itself emits. Following the
links on `?p=view_event&id=<event>` gives `p=view_race_result&id=<report>`,
which returns a per-rider `Lap Times` table with `LAP TIME`, `SECTORS`, `PACE`
and a **per-lap position** column (`38th`, `37th`, …). Verified on the 2025 Ironman event (1,393,052 bytes, 1,555 lap-time strings). See ADR 0003.

### 14.8 The whole 2020–2024 archive is ingestible

Every round from 2020 to 2024 was surveyed and then built: **55 events** (2020: 9, 2021: 12,
2022: 12, 2023: 11, 2024: 11), **8,720 result rows**, **123,238 per-lap times**, from 546 hashed
PDFs. `npm run survey` reports no `refused` and no `invalid` event.

The first survey run reported 33 failures. Every one of them was a source anomaly rather than a
layout the parser could not read, which is why the gate was split (14.10): an archive this size
contains misprints, and a parser that refuses on them cannot produce a dataset at all.

### 14.9 Two column-edge hazards in the results sheet

Both come from columns that abut rather than separate:

- **A flush hometown eats the bike.** `Landsborough, Australia Honda CRF450R WE` has a single
  space between the two fields, so a `HOMETOWN` column read returns the hometown *and* the bike,
  and the bike read then lands on the interval. Every layout prints the bike starting with its
  brand, so the bike is anchored on that vocabulary instead of on a column offset.
- **A long name leaves its tail in the next column.** `Jorgen-Matthias Talviku` outgrows its
  column and the hometown window returns `u`. A field that is merely the end of the name is
  overflow, so the value is taken from the continuation line instead.

Before this, 376 rows had no bike and about 60 had an interval (`+1:22.282`) in the bike field.
Six rows now have no bike at all — the same plate `#451` in four 2024 motos, where the sheet
prints none.

### 14.10 One sheet prints a lap number twice

Three 2020 rounds (`M2015`, `M2020`, `M2025`) end a rider's column with the last lap number
printed twice: `1..15`, then `15`. The results sheet gives the same rider 15 completed laps, so the
repeat is an artefact of the print, and the second entry is **dropped** with a warning. It is not
renumbered: renumbering would invent a sixteenth lap and contradict `lapsCompleted`.

### 14.11 The gate separates contradictions from source anomalies

§10 described one severity. It now has two, recorded in ADR 0004:

- **errors** — a structural contradiction the parser controls: duplicate or non-contiguous
  positions, duplicate plates, a missing rider id, a malformed source hash. These fail the build.
- **warnings** — an anomaly in the source: an implausible lap time, a published best time that is
  not in the lap list, a qualifying order that does not follow the times, a lap time missing from
  the sheet, a lap number printed twice. The dataset records what the sheet says and names the
  anomaly.

The dataset carries **1,090** such warnings across all 77 events. Failing the build for them would
have published nothing and taught the next person to switch the gate off.

---

## 15. 2025–2026 on `results.promotocross.com` (built 2026-11-04)

ADR 0003 verified the per-lap data and stopped there; this is what building the
adapter added. Both seasons are now ingested: 11 championship rounds each, four motos and two
combined qualifying reports per round.

### 15.1 Discovery has two layers, and neither can be constructed

`https://results.promotocross.com/events/` lists every event with a date and an id — including side

events (`WMX`, `Moto Combine`), which are excluded by name. Each event hub then links its own
reports. Moto reports appear under **three different labels** for the same thing:

```
250 Moto 1          (most 2025 rounds)
250 Class Moto 1    (2025 season opener)
250 Class Moto #1   (2026)
```

A parser that matches only the first style silently ingests 10 of 22 events. The hub also links
`Qualifying 1 Group A`, `Consolation Race` and `Overall Results` reports, which are **not** the
championship motos and are not ingested.

### 15.2 `INTERVAL` is not laps completed

The results table reads `POS | # | BIKE | RIDER | INTERVAL | BEST LAP (LAP #) | TOTAL TIME | …`. For
the winner `INTERVAL` is `17 Laps`; for a rider a lap down it is `1 Lap`, and for one 13 down,
`13 Laps` — that is how far **behind** the rider finished, not how far he rode. The count of laps
ridden is in `TOTAL TIME`, printed as `4/8:50.212` (laps / elapsed). Reading `INTERVAL` as the lap
count made 40th place look like a 13-lap rider with 4 lap times.

### 15.3 The results table appends ` Holeshot` to a rider's name

Whoever took the holeshot has it appended in the name cell: `HAIDEN DEEGAN Holeshot`. Left in
place it splits one rider into two identities across a season (`haiden-deegan` and
`haiden-deegan-holeshot`), which is exactly what the roster is meant to prevent. It is an
annotation, so it is stripped.

### 15.4 A best lap is sometimes printed without milliseconds

`BEST LAP` is usually `2:05.182`, but occasionally `2:04` — rounded to the second, so it can never
equal any lap time. Comparing it to the lap list produced ~150 false anomalies per event; a
whole-second best lap is now not compared at all rather than reported as a mismatch.

### 15.5 Red-flag laps are real and are kept

The source prints laps of ~20 minutes (1,228,570 ms at Washougal 2025, lap 4 of 450 Moto 2). These
are real timings around a red flag, not parse errors, and they are recorded as warnings with the
value as printed.

### 15.6 A number is unique per class, not per season

`#1` is the 450 champion and the 250 champion in the same season. Keying a roster on the plate
alone produced 51 conflicts for 2025; keyed on `class:plate` it produces none, and a real conflict
would now be visible. Roster: `data/rosters/<year>.json`, built by `scripts/lt-season.js`.

### 15.7 What this unlocks, and what it does not

Per-lap **positions** exist for 2025–2026 and for nothing earlier (§14.1). Analyses that need
them — lap chart, position fade — are 2025–2026 only unless they are redefined in time terms for
2020–2024. That split has to be stated on the site, not papered over.

---

## 16. Rider identity, and the name column that spills (built 2026-11-04)

Every 2020–2024 result row carries a plate, a name and an id, so a roster needs no extra source.
What it does need is a way to survive the results sheet's layout: **2020–2024 print a long name past
its column**, into the hometown column, so the same rider is read twice:

```
#124  Lane Shaw         Alv          -> lane-shaw-alv   (1 row)
#124  Lane Shaw                      -> lane-shaw       (9 rows)
```

**204 plates across 2020–2024** are affected this way, from 1–2 rows each. They are folded, not
repaired: `data/rosters/<year>.json` maps `class:plate` to one rider and lists the other spellings as
`aliases`, so an analysis built on a row's own id can still join the rider.

Folding requires the two printed names to be the same name with a tail of at most five characters
(`Lane Shaw Alv`, `Gerhard Matamoros Hon`, `Jorgen-Matthias Talviku Esto`). Anything else is kept as
a separate rider and reported as a warning, because it is a genuinely different rider on the same
number — e.g. `450MX #280` in 2020 is both Cade Clason and William Clason. That entry keeps both ids
in `otherRiders`, so a shared number is visible in the data and not only in prose; silently merging
them would be inventing a rider.

The roster is built from committed events only (`npm run roster`, or `scripts/lt-season.js` as part
of ingest), so it is offline, deterministic, and its diffs are reviewable.

### 16.1 The spill is fixed at the parser, not folded away

Folding was the wrong end of the problem, so the boundary is now measured instead of assumed. Two
things make it measurable:

- **The place column does not start where its label does.** `HOMETOWN` is set at column 34 while its
  values can begin at 32 (`Joseph Crown      Metamora, MI`), so the leftmost place start that any row
  on the sheet shows is the column edge. A shorter place sitting a couple of characters further
  right costs nothing — the leading spaces are trimmed.
- **A place never starts lower-case.** When a row still lands mid-word (`Matamoros Hon` + `duras`),
  the field is stepped back to the start of that word. On a wrapped row this is skipped: the field
  after the boundary there is the rest of the *name* (`Talviku`), not a place, and stepping back
  would hand the surname to the hometown.

All 55 PDF-era events were rebuilt from the cached source PDFs. Every field other than `name`,
`hometown` and the `riderId` derived from them is byte-identical to before the fix, which is how the
rebuild was checked. The roster now folds nothing in any season — `aliases` is empty everywhere — and
the one remaining shared number is real: `450MX #280` in 2020 is both Cade and William Clason.

The RID sheets are untouched by any of this: they carry plates, and the results sheet is the only
place names are read from. A future layout change is caught by the scanning test that refuses a
committed row with a column gap left in its name or a place that does not start upper-case.
