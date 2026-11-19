# 13 — Migration mapping matrix

Status: **Verified locally** for `sen-tuan` and `bag-post` on 2026-11-19 (branch `stabilize/local-2026-11-19`).

## Purpose

`check:migration` only proves that the v2 collections hold at least as many *rows* as the legacy source. A mapper can still silently drop a *field* and the row count stays green (every tag was missing for a day because nothing printed that number). This document is the field-level counterpart: every populated legacy field, where it lands in v2, how many rows carry it on each side, and whether the target count is at least the source count.

The matrix is produced by `pnpm migration:mapping` (`scripts/ops/migration-mapping.ts`). It is read-only: no write, no `--apply`, no credential value printed (only allowlisted identity keys by name).

## Command

```bash
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=<legacy-db> pnpm -s migration:mapping --site <siteId>
```

- `<legacy-db>` is the customer-named database (`sen-tuan`, `bag-post`), not the `app_*_cms` side. The same database holds both the legacy collections (`contents`, `items`, `item_categories`) and the v2 collections (`content`, `catalog_items`, `catalog_categories`).
- `<siteId>` is the v2 site key (`sentuan`, `bagpost`).

## Verdict vocabulary

| Verdict | Meaning |
| --- | --- |
| `ok` | Target count ≥ source count. The field is carried. |
| `reported — <note>` | The field is intentionally not carried (no column, no renderer, or a known data issue). The note explains why; the count on the v2 side is expected to be lower. |
| `FEWER THAN SOURCE` | Target count < source count and no note. **Failure** (`process.exitCode = 1`): a mapper dropped a field. |

A field with zero source rows is omitted from the table entirely, so the report only lists fields that actually carry data.

## Present rule

A value counts as present when it is not null, undefined, blank, empty, or a zero-length array/object. Dates are present when valid. For numeric migration bookkeeping (`legacy.sort`, `legacy.views`) and the `display` flags, a zero / false value is treated as *not present*, because `legacyContentAttributes` only writes those when they are non-zero / true. The matrix therefore matches what the importer actually writes, instead of flagging every zero as lost data.

## Domains covered

- **Content** — `contents` → `content` (title, slug, body, excerpt, SEO, thumbnail, format, template, sort, views, display, tags, categories, gallery, media, status, soft delete, publishedAt, timestamps).
- **Catalog items** — `items` → `catalog_items` (title, slug, descriptions, thumbnail, gallery, price, SKU, barcode, UOM, type, stock, manageStock, variants, attributes, tags, categories, SEO, status, soft delete, sales/views, publishedAt).
- **Catalog categories** — `item_categories` → `catalog_categories` (title, slug, fullPath, description, thumbnail, order, parent, ancestors, SEO, soft delete).
- **Settings** — allowlisted identity keys present in the legacy `system_configs`, plus whether a v2 `settings` document exists.

## Known reported fields (not failures)

| Field | Why it is reported |
| --- | --- |
| `items.minStock / hasImei / reserved`, `items.supplierPrices`, `items.options` | No v2 column yet (inventory / pricing model is P6). |
| `items.fullPath` | Counted in the redirect report, not as a product column. |
| `items.categories` | Unresolved legacy category references are reported by `migrate:catalog` and dropped (2 rows in `sen-tuan`: `man-khung-ngang`, `man-khung-ngang-a39578` → `69c0fa6a041acbc0ed36f0ff`). |
| `contents.gallery`, `contents.media` | No media-id mapping; marked `legacy.incomplete` (J1). |

## Evidence (2026-11-19)

| Site | Source rows | v2 rows | Exit code | FEWER count |
| --- | --- | --- | --- | --- |
| `sen-tuan` | contents 8, items 241, categories 67 | content 9, catalog_items 241, catalog_categories 67 | 0 | 0 |
| `bag-post` | contents 18, items 0, categories 0 | content 18, catalog_items 0, catalog_categories 0 | 0 | 0 |

- `sen-tuan`: `items.categories` reports 239/241 carried (2 unresolved refs); `item_categories.pid` carries 61/61 after the topological write-order fix in `migrate-catalog.ts`.
- `bag-post`: no items or categories exist in the source copy; the report says so instead of implying a wrong database.
- Settings identity keys available on both: `site_name`, `site_description`, `content_locales`, `enabled_modules`; a v2 `settings` document is present on both.

## Related

- `pnpm check:migration` — row-level parity report (the coarse gate).
- `pnpm test:migrate-apply` — 53 checks covering the importers' `--apply` half.
- `docs/v2/05-feature-parity.md` §J1 (incomplete-record marker) and `docs/v2/08-operations-and-verification.md` (migration runbook).

## Limitations

- The matrix compares counts, not values; a field carried with the wrong value is not caught here. Value-level checks live in `test:migrate-apply` against the synthetic fixture.
- `bag-post` has no catalog data, so the catalog section is empty by construction.