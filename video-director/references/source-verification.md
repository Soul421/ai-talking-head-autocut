# Source And Data Verification

## Source hierarchy

Prefer sources in this order:

1. Original dataset, official company publication, regulator, government, or
   first-party documentation.
2. Reputable research organization with a published methodology.
3. High-quality reporting that links to the original evidence.
4. Aggregators and estimates with clear methodology.
5. Unverified posts, screenshots, or unattributed claims.

Use lower-tier sources only when necessary and label the limitation.

## Claim verification

For each factual on-screen claim, record:

- exact claim;
- source URL or local source file;
- publisher and publication date;
- relevant measurement period;
- whether it is first-party, reported, or estimated;
- definition and unit;
- corroborating source when the claim is central or surprising;
- confidence: high, medium, or low;
- how it may be phrased safely on screen.

Block a claim when its source cannot support the exact wording. For example,
"monthly visits" does not prove "monthly users", and a traffic estimate does
not prove an audited count.

## Structured data checks

Before visualizing CSV, JSON, spreadsheet, or API data:

1. Preserve the original file under `data/raw.*`.
2. Inspect field names, types, units, date range, and granularity.
3. Check missing values, duplicates, impossible values, and abrupt anomalies.
4. Confirm whether categories and names remain consistent over time.
5. Document filters, joins, interpolation, normalization, and ranking logic.
6. Export production-ready data to `data/cleaned.*`.
7. Write `data/schema-report.md`.

Do not silently fill missing values or combine incompatible measures.

## Asset verification

For every downloaded or externally sourced asset, record:

- original URL and creator/publisher;
- date accessed;
- local path;
- asset role in the video;
- license or permission status;
- whether attribution is required;
- edits made;
- resolution, dimensions, or duration where relevant.

Do not download assets from a page merely because they are visible. Prefer
official press kits, public-domain sources, Creative Commons sources with
compatible terms, or user-provided materials.

## Confidence language

- High: state directly, with concise source attribution.
- Medium: use wording such as "estimated", "reported", or "according to".
- Low: remove from the core story or explicitly frame as uncertain.

