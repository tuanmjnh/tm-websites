# 14 — Legacy parity audit (2026-11-23)

Structural and runtime comparison of `nuxt4-cms` / `nuxt4-website` against `tm-cms` / `tm-web`.
This is evidence for the rows in [05 — Full feature parity matrix](05-feature-parity.md); it does not
change any row's status by itself.

## 1. Method and environment

| Item | Value |
| --- | --- |
| Legacy sources | `D:\Applications\nuxt4-cms` (984 TS/Vue files), `D:\Applications\nuxt4-website` (227) |
| New sources | `tm-cms`, `tm-web`, `tm-shared` |
| Node / pnpm | 24.22.2 / 12.15.0 |
| MongoDB | local `127.0.0.1:27017` |
| Isolated gate database | `tm-websites-audit` (created for this audit) |
| Customer database inspected | `sen-tuan` (declared by `tm-shared/customer-layers/registry/customers.ts` for `sentuan`) |

Commands run:

```sh
# gates on a database created for this audit
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=tm-websites-audit \
TM_SITE_ID=sentuan pnpm verify:all
# production builds and their validators
TM_CUSTOMER_ID=sentuan pnpm build:cms && pnpm validate:build:cms
TM_CUSTOMER_ID=sentuan pnpm build:web && pnpm validate:build:web
# migration parity against the customer database
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=sen-tuan TM_SITE_ID=sentuan pnpm check:migration
```

Result: **67/67 gates pass** (338.9s) on the isolated database, **4/4 build steps exit 0**, and
`check:migration` reports `parity: every migrated domain holds at least what the source does`
(content 8→9, content categories 6→6, catalog items 241→241, catalog categories 67→67,
redirects 301, settings identity present).

### Live runtime check

Both apps were started against the customer database (`TM_MONGO_URI` set, `TM_MONGO_DB` unset so the
registry name is used).

| Request | Answer |
| --- | --- |
| `GET :4005/api/health` | `{"status":"ok","hub":"configured","database":"ok","authMode":"hub"}` |
| `GET :4005/api/v1/admin/settings` (no session) | `401` |
| `GET :4006/api/public/site` | site settings from Mongo: company `Sen Tuấn CMS`, locales `["vi","en"]`, `menus: []` |
| `GET :4006/api/public/products?limit=2` | migrated catalog rows (`Ruột gối thường`, 120000 VND, `/products/ruot-goi-thuong`) |

### The database override is fail-closed

`GET /api/health` answered `database: "error"` while both servers ran with
`TM_MONGO_DB=tm-websites-audit`, because `resolveDatabaseBinding` rejects a database name that
disagrees with the registry (`DATABASE_BINDING_MISMATCH`, `tm-cms/server/utils/database.ts:54`).
A local database can therefore only be used by a running app if it is the name the registry declares
(`sen-tuan`, `bag-post`). Gate scripts bypass this and honour any `TM_MONGO_DB`, which is why the
audit database works for `verify:all` but not for a dev server.

## 2. Inventory: routes

| Surface | Legacy | New | Difference |
| --- | --- | --- | --- |
| CMS admin API routes | 307 | 222 | −85 |
| CMS portal/supplier/public/root routes | ~40 | 17 (`v1/me`) + 4 (`v1/public`) | supplier portal missing |
| Website API routes | 21 | 19 | discovery/tag endpoints replaced by listing queries |

Legacy admin modules with **no target folder at all**:

| Legacy module | Routes | Notes |
| --- | --- | --- |
| `admin/attributes` | 10 | attribute definitions per scope (`item`, `content`) with sort/check |
| `admin/keywords` | 8 | global keyword/hashtag collection across scopes |
| `admin/products` | 36 | split into `catalog/*`; `options`, `pricing`, `items/:id/variants|serials|suggestion|supplier-comparison` have no target |
| `admin/menu` | 17 | replaced by `menus/*` (5 routes) — item nesting, sort and `settings.patch` are narrower |
| `admin/system` | 56 | `users` 19 and `roles` 10 are Hub-owned (by design); `data` 10, `routes` 9, `config` 6, `import` 2 have no target |
| `admin/shipping` | 4 | carriers, rates, tracking |
| `admin/dashboard` | 1 | `SYS-01` still placeholder |

Legacy modules with a target folder but missing sub-surfaces:

| Legacy | Missing in new |
| --- | --- |
| `settings/*` (22) | `company` 3, `connect` 10, `mail` 4, `shipping` 5 — new has `settings` index + patch only |
| `finance/reports` (11) | `pnl`, `revenue-chart`, `stats`, `top-debtors`, `top-products`, `inventory-value`, `debt-details`, `partner-transactions`; new has `summary`, `aging`, `ledger`, `ledger.csv` |
| `media/*` (9) | `cloudinary` 7 + `config` (provider adapter; new stores locally by design) |
| `inventory/*` | `sku`, `stock/*`, `transactions`, mixed `suppliers`/`warehouses` list+sort endpoints |
| `commerce/*` | `pos` 2, `templates` 4 (document templates) |
| `notifications/*` | `stats` |

Caveat: a legacy `*/list` endpoint is usually the new cursor `GET index`, so a leaf-name comparison
overstates the gap. The module-level list above counts only whole surfaces that have no equivalent.

## 3. Inventory: models and collections

Legacy declares 43 collections, new declares 43; the names mostly differ (`items`→`catalog_items`,
`contents`→`content`, `medias`→`media`, `menu_items`→`site_menus`, …). Collections with **no new
counterpart**:

| Legacy collection | Status |
| --- | --- |
| `attributes` | missing (per-record attributes exist in `catalog_items.attributes` / `content` only) |
| `keywords` | missing (tags + per-record SEO keywords only) |
| `options` | missing (`catalog_items.variants` embeds option values instead) |
| `document_templates` | missing (printable quotation/receipt templates) |
| `shipping_carriers` | missing (`crm_shipments` stores a carrier string) |
| `system_configs` | missing (69 rows of typed key/value configuration) |
| `system_datas` | missing (117 rows of social links, units, sources) |
| `system_routes` | missing (202 rows of the admin route registry) |
| `counters` | missing (order/quotation code sequences; new derives codes from idempotency keys) |
| `carts` | missing (cart lives in the browser; `POST /api/public/cart/validate`) |
| `companies` | folded into `settings.company` |
| `connects` | Hub-owned connection registry (by design) |
| `users`, `roles`, `user_sessions`, `webauthn_credentials` | Hub-owned (by design) |
| `histories` | replaced by `audit_logs` |
| `payment_transactions` | replaced by the `crm_payments` ledger |

## 4. Data configuration: what the customer database shows

`sen-tuan` holds 84 collections: the legacy ones are populated, the new `crm_*` ones are empty.

| Domain | Legacy rows | New rows |
| --- | --- | --- |
| catalog | `items` 241 → `catalog_items` 241 | migrated |
| content | `contents` 8 → `content` 9 | migrated |
| menus | `menus` 9, `menu_items` 164 | `site_menus` **0** |
| company identity | `companies` 1 (name, slogan, address[], phone, email, taxCode, social, bankAccounts, openingHours, mapEmbed, gallery, seo) | `settings.company` = `{name, names}` only |
| CRM | `customers` 3, `customer_segments` 2 | segments migrated 2/2; `crm_customers` **0** (blocked on the Hub identity map, §8) |
| inventory | `inventories` 49, `warehouses` 3 | migrated 49/49, 3/3 |
| purchasing | `purchase_orders` 6, `suppliers` 3 | migrated 6/6, 3/3 |
| quotations | `quotations` 3 | migrated 3/3 |
| attributes / keywords / options | 0 / 0 / 4 | no target collection |
| system config | `system_configs` 69, `system_datas` 117, `system_routes` 202 | no target collection |

Visible consequences in the live app: `/api/public/site` returns `menus: []` and empty
`email`/`phone`/`address`, although the legacy company document has all of them.

`scripts/ops` now has `migrate:catalog`, `migrate:content`, `migrate:redirects`, `migrate:settings`,
`migrate:company`, `migrate:crm` and `check:migration`. There is still no migration for menus,
finance, HR or the `system_*` configuration.

## 5. Zod and validation

Legacy imports Zod in 12 files (mostly auth endpoints). The new tree imports it in 191 files
(130 API routes, 33 models, 23 shared contracts, 2 web routes, 2 utils, 1 config package).
Validation is therefore **ahead of legacy, not behind it**. A missing module implies missing Zod
schemas for it (attributes, keywords, POS, provider settings, system configuration), so validation
gaps are a consequence of the module gaps in §2, not an independent gap.

## 6. Verdict

| Area | Complete? |
| --- | --- |
| Content, catalog, categories, media, menus (schema), settings, redirects | Yes, migrated and served |
| CRM, commerce, inventory, purchasing, finance, HR | Schema and API present, **no migrated data** |
| Company/system configuration (`system_configs`, `system_datas`, `companies`) | Missing target model and migration |
| Menus data | Missing migration (`site_menus` empty) |
| Attributes, keywords, options, document templates, shipping carriers | Missing module |
| POS, supplier portal, finance report detail, dashboard aggregates | Missing module |
| Provider settings (`connect`, `mail`, `shipping`) | Missing module (Hub owns connections; mail is env-driven) |
| IAM users/roles | Owned by Hub — not a gap |
| Zod validation | Ahead of legacy |

## 7. Recommended order

1. **Migrate the missing domains' data**, starting with `site_menus` and `settings.company`: both are
   user-visible on the storefront today and need no new model. `settings.company` landed
   (`migrate:company`, see §8); `site_menus` is blocked on the item-limit decision in §8. Then
   CRM/inventory/purchasing (`migrate:crm`, landed — customers still need a reviewed Hub identity map).
2. **`system_configs` / `system_datas`**: decide the target shape (either a `settings` extension or a
   dedicated collection) before writing the migration, because 186 rows of typed configuration
   currently have no home.
3. **Menus/attributes/keywords/options/document templates**: fill the module gaps listed in §2.
4. **POS, supplier portal, finance report detail, dashboard aggregates**: the remaining feature work
   from the parity matrix (`COM-01`, `POR-02`, `FIN-02`, `SYS-01`).

Adding a production-build job to CI is independent of this list and was done in the same change.

## 8. Follow-up (2026-11-23, same day)

### Company identity — migrated

`pnpm migrate:company --site <customerId> [--apply] [--replace-name]` carries the legacy `companies`
document into `settings.company`. It is dry-run by default, fills only empty destinations, bumps
`revision`, and names every legacy field that has no v2 destination (`shortName`, `website`, `fax`,
`logo` — an inline SVG with no media record, `favicon`, `banner`, `mapEmbed`, `gallery`, `social`,
`bankAccounts`, `openingHours`, SEO `keywords`/`image`).

Applied to `sen-tuan` with `--replace-name`, because `migrate:settings` had seeded
`company.name`/`names.vi` from `system_configs.site_name`, which held the CMS name. Result:
`company identity 6/6 fields filled`, and a rerun reports `nothing to fill`.

Runtime check after the migration: `GET :4006/api/public/site` returns
`name: "Doanh nghiệp tư nhân nội thất Sen Tuấn"`, the legacy email, phone and address, and both
locale names. The first request after the write still served the old value because the storefront
cache is only purged by a CMS write or a revalidate call, not by a direct database write; restarting
the dev server showed the new value, so the staleness was cache, not data.

`check:migration` now reports the company field count and the menu gap, and prints a separate
`still to import:` line so the final `✅ parity` line is not read as full coverage.

### Menus — blocked on a model limit, not on data

A menu import cannot be a 1:1 copy: `MENU_MAX_ITEMS` is **30 per menu** and `MENU_MAX_CHILDREN` is
**10 per parent** (`tm-shared/packages/flow-contracts/src/menu-admin.ts`), while `sen-tuan` holds
**76** items in the header menu and **56** in product-categories, and many items are children of
children (v2 menus support one nesting level). Handling that needs a decision, not a script:

- raise `MENU_MAX_ITEMS` / allow a second nesting level, accepting the editor and rendering cost, or
- split each oversized menu into `header` + `header-more`, which changes the site's navigation shape.

Until then `migrate:*` has no menus importer, `site_menus` stays empty, and the storefront returns
`menus: []`.

### CRM, inventory, purchasing, quotations — migrated

`pnpm migrate:crm --site <customerId> [--apply] [--identity-map <file>]` copies
`customer_segments` → `crm_customer_segments`, `suppliers` → `crm_suppliers`, `warehouses` →
`crm_warehouses`, `inventories` → `crm_inventories`, `purchase_orders` → `crm_purchase_orders` and
`quotations` → `crm_quotations`. Dry run by default, matched on the business key (`code`, or
item+variant+warehouse for a stock balance) so a rerun updates instead of duplicating, and nothing
legacy is deleted. References resolve through the migrated data: a legacy item id maps to
`catalog_items.legacyId`, a warehouse/supplier id to the row written in the same run, and a variant to
its SKU (v2 keeps variant SKUs, not legacy variant ids).

Status vocabularies differ, and the mapping is printed: purchase order `completed` → `received`,
quotation `submitted` → `sent`, and a cancelled quotation → `rejected` (v2 has no quotation
`cancelled` state).

Applied to `sen-tuan`: segments 2/2, suppliers 3/3, warehouses 3/3, inventory 49/49, purchase orders
6/6, quotations 3/3; a second run writes the same rows and the re-read verification passes. The
command also reported, instead of hiding: 6 purchase orders whose `supplierId` no longer exists in the
legacy `suppliers` collection (stored `null`), 3 quotations whose customer is not migrated (stored
`null`), legacy fields with no destination (`purchase_orders.createdBy`, `quotations.history`,
quotation line `importPrice`/`supplierId`).

`check:migration` now counts these domains, so `✅ parity` covers them; a gap prints under
`still to import:`.

### Customers — need a reviewed Hub identity map, not an email guess

A v2 customer carries `subjectId` (the Hub subject) and the migration plan requires legacy local user
ids to be joined to Hub subjects **through a reviewed identity table**, explicitly not by email. So the
importer takes `--identity-map <file>` = `{ "<legacy userId or customer id>": "<Hub subject>" }`.
Without it the 3 customers in `sen-tuan` are reported as skipped and no row is written, because a
placeholder subject would occupy the unique `(site, subject)` slot and could never be relinked
(`CUSTOMER_SUBJECT_IMMUTABLE`).

The mapped path was verified on a throwaway database built from the same 3 legacy customers: code,
subject, email/full name/phone from the legacy user, addresses, segment link, loyalty points and note
all landed, then the database was dropped. What remains is an owner input, not code: the reviewed
`legacy userId → Hub subject` table.

### Not yet migrated

`menus` (see above), `system_configs` 69 / `system_datas` 117 / `system_routes` 202 (no target model),
finance, HR, `document_templates` and `connects` (Hub-owned).
