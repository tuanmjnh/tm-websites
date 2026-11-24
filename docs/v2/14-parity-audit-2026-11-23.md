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
| menus | `menus` 9, `menu_items` 164 | `site_menus` 7 (includes the header under `main`; three footer menus merged into one) |
| company identity | `companies` 1 (name, slogan, address[], phone, email, taxCode, social, bankAccounts, openingHours, mapEmbed, gallery, seo) | `settings.company` = `{name, names}` only |
| CRM | `customers` 3, `customer_segments` 2 | segments migrated 2/2; `crm_customers` **0** (blocked on the Hub identity map, §8) |
| inventory | `inventories` 49, `warehouses` 3 | migrated 49/49, 3/3 |
| purchasing | `purchase_orders` 6, `suppliers` 3 | migrated 6/6, 3/3 |
| quotations | `quotations` 3 | migrated 3/3 |
| payments | `payment_transactions` 1 | migrated 1/1 |
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
| Menus data | Imported, header and all three levels (§8) |
| Attributes, keywords, options, document templates, shipping carriers | Missing module |
| POS, supplier portal, finance report detail, dashboard aggregates | Missing module |
| Provider settings (`connect`, `mail`, `shipping`) | Missing module (Hub owns connections; mail is env-driven) |
| IAM users/roles | Owned by Hub — not a gap |
| Zod validation | Ahead of legacy |

## 7. Recommended order

1. **Migrate the missing domains' data**, starting with `site_menus` and `settings.company`: both are
   user-visible on the storefront today and need no new model. `settings.company` landed
   (`migrate:company`, see §8); `site_menus` is imported in full, including the header, see §8. Then
   CRM/inventory/purchasing (`migrate:crm`, landed — customers still need a reviewed Hub identity map).
2. **`system_configs` / `system_datas`**: decide the target shape (either a `settings` extension or a
   dedicated collection). A key-by-key read of the 69 config rows shows most are out of scope rather
   than missing: `jwt_secret`/`jwt_refresh_secret`, `cloudinary_*`, `firebase_*`, `vapid_*`,
   `revalidate_secret`, `*_mongo_uri`/`*_mongodb_name` and `history_*` are credentials or
   infrastructure and must not be copied into a site document. The 4 identity keys
   (`site_name`, `site_description`, `content_locales`, `enabled_modules`) are already imported by
   `migrate:settings`; what remains is a small set of UI/business toggles (`site_footer_text`,
   `copyright`, `website_url`, `keywords`, `pagination_type`, `maintenance_mode`, `allow_*` flags)
   with no v2 field — a settings-model decision, not a migration gap.
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

### Menus — imported, header included

Three contract gaps had to be closed before any menu could be imported.

**Caps.** `MENU_MAX_ITEMS` was **30 per menu** and `MENU_MAX_CHILDREN` **10 per parent**, while
`sen-tuan` holds **56** items in product-categories (one parent with 20 children) and a header whose
rows reach three levels. The caps are now **120 / 30** — still bounded, but a real site's navigation
fits. The gate that asserted the old numbers now reads the constants, so the test moves with the
contract.

**Depth.** A dropdown row could not own rows of its own, so the legacy header (5 top rows → 11
dropdown rows → 34 links) had nowhere to go. The model now stores two nesting levels below an item
(item → child → link), the editor edits the third level with its own add/edit/remove/move/promote
buttons, and the storefront header renders a column heading with its links indented under it. A
fourth level is refused with `MENU_DEPTH_LIMIT`.

**Product-category links.** Legacy items are 130 `item_category` links, but v2's `category` link
resolves against content categories only (`/danh-muc/<slug>`), and product categories render at
`/categories/<slug>`. A new `product-category` link type closes that: contract list, model target
validation, service reference check (live catalog category only), `link-options` (a separate picker
list), public href, and the editor's type select + label. It is a reference, so renaming a category
does not break the menu.

With those, `pnpm migrate:menus --site <customerId> [--apply]` imports all nine legacy menus:

| Legacy | v2 | Result |
| --- | --- | --- |
| `header-menu` | `main` | 50/50 rows (5 top, 6+5 dropdown, 34 links) — the key the storefront header reads |
| `product-categories` | `product-categories` | 47/56 items (8 point at categories that were deleted before the import) |
| `post-categories` | `post-categories` | 5/5 |
| `featured-products` | `featured-products` | 2/3 |
| `footer-products` + `footer-news` + `footer-resources` | `footer` | 14 items merged, the storefront renders one flat footer column |
| `customer-sidebar` | `customer-sidebar` | 5 visible rows (1 hidden legacy row dropped) |
| `supplier-sidebar` | `supplier-sidebar` | 3/3 |

Targets resolve through the migrated data, not through the old URL text: a `page` item becomes a
`content` link via the legacy content id → localized slug → migrated content key, `post_category`
becomes a `category` link via the slug, `item_category` becomes a `product-category` link via
`catalog_categories.legacyId`, and a `url` item is kept only when it is a rooted path or an absolute
URL (a dead dynamic route such as `/customer/orders/[id]` is dropped and counted). Re-running the
command updates the same seven documents and never duplicates them; `check:migration` accounts for
the footer merge and shows 7/7.

Runtime check (`tm-web` on `:4006`, `sen-tuan`): `GET /api/public/site?locale=vi` returns all seven
menus and 126 rows with no missing `href`. `main` comes back as the header the site renders:
`Sản phẩm → /san-pham` with six product-category rows, each carrying its own links
(`Chăn ga gối đệm /categories/chan-ga-goi-dem` → `Chăn /categories/chan-ga-goi-dem-chan`, …);
`footer` is 14 flat links. The server-rendered home page already contains a level-3 `href`, so the
nested dropdown reaches HTML and not only the JSON. Gates: `test:menus` 16 checks, `test:web-site`
27 checks, `pnpm verify:all` **67/67**.

### Catalog — variant options that were silently dropped

`migrate:catalog` read attribute labels and values with the locale-map reader, so the plain-text
shape legacy actually stores (`{ k: 'Kích thước', v: '160X200' }`) mapped to `{}`: all 626 variant
options of `sen-tuan` were written as `attributes: []`, which made every variant of a variable
product indistinguishable. The mapper now reads plain text as Vietnamese while still accepting a
locale map, and the catalog report prints `variantAttributes` so a zero is visible in the dry run
instead of looking like clean data.

Evidence: `pnpm test:legacy-import` covers both shapes (`{ k, v }` strings and localized maps) and
`pnpm test:migrate-apply` asserts the migrated variant carries the option. Re-running
`migrate:catalog --site sentuan --apply` reports `variantAttributes: 626` and the collection now
holds 626 of 626 variants with attributes; `check:migration` is unchanged (241/241 items).

The storefront then gained the picker these options were meant for. Legacy names an option by code
(`kich-thuoc`) and keeps the readable title on the item's own `options` list, so the importer now
resolves each attribute through it: the dry run reports `optionLabels: 678` (0 before) and the group
label reads `Kích thước` instead of `kich-thuoc`. `products/[slug]` renders one chip group per option
(`Kích thước`, `Độ dầy`), marks the active value, and disables a value whose combination the catalog
does not hold; a product with no options keeps the plain variant list. The chips are checked by
`pnpm test:web-variant-options` (8 checks) and the code→title mapping by `test:migrate-apply`.

Verified over HTTP on `:4006` with real data: `GET /api/public/products/dem-kc-titalium` returns 25
variants each carrying `attributes`, and the server-rendered page contains both groups, two pressed
chips and disabled chips for missing combinations. Chip clicks were not exercised in a browser.

Quotations were the flip side of that gap: the module had a service and fifteen admin routes since
2026-11-19 but no CMS screen, so the three quotations on `sen-tuan` were invisible. `/quotations`
now lists them (search, status filter, counts) and `/quotations/[id]` renders an A4 sheet — customer
and address snapshot, lines with their option attributes, subtotal/shipping/discount/total, notes and
signatures — printed through the browser while the toolbar and navigation stay `print:hidden`. The
sheet's toolbar re-statuses the quotation with its `revision`, so a stale tab cannot overwrite another
edit. There is still no create/edit quotation form.

The CMS catalog editor edits the pairs as well: every variant row carries its own option list
(name/value with add and remove), blank rows are dropped before the payload, and `test:catalog`
creates a variant with an option, reads it back and replaces the set on update. A newly created
variable product can therefore declare its size/colour options instead of inheriting them from the
migration.

### Dashboard — real business counts

The control centre listed Hub installation facts only, so `SYS-01`'s "real scoped aggregates" had
no surface at all. `GET /api/v1/admin/dashboard/summary` now answers six counts from the site's own
collections: content published/draft, catalog published/draft, orders still open
(`pending|processing|shipped`), quotations still open (`draft|sent`), live customers and inventory
balances at or below their own threshold (available = on hand − reserved, and a threshold of `0`
means "not tracked", not "always low"). Every query is site-scoped and skips soft-deleted rows; the
route reuses the `content.read` capability and answers `no-store`.

The CMS front page renders those as a "Business activity" card grid, each row linking to its module;
a module the customer is not entitled to (catalog, orders, inventory) is left out instead of shown as
zero, and a failed read leaves the rest of the dashboard working.

Evidence: `pnpm test:dashboard` (new gate) — 6 checks in a disposable database: empty site answers
zero, status filters, soft deletes excluded, available quantity vs. threshold, and another site
contributing nothing. Lint and typecheck pass. A live read against `sen-tuan` returns
`content 8 published / 1 draft`, `catalog 229 / 3`, `orders 0 open`, `quotations 2 open`,
`customers 0`, `inventory 0 low`, which matches the collections the migration left there. The card
grid itself was not clicked through in a browser.

### Storefront settings — footer, website, hours, social

The remaining legacy configuration that is *content* rather than infrastructure now has a
destination: `settings.site`. It holds `footerText`, `copyright`, `websiteUrl`, `keywords`,
`maintenanceMode`, per-locale `openingHours` and up to twelve `social` links (`{code,label,url}`).
The storefront reads it through `/api/public/site` and renders the footer line, the opening
hours and the social buttons from it; a site without the section keeps the built-in footer.

The same review rule as before applies: a `system_configs` key is imported only if it is on
the allowlist **and** does not look like a credential. `migrate:settings` now also carries
`site_footer_text`, `copyright`, `website_url`, `keywords` and `maintenance_mode`; it still
never overwrites an existing settings document, and on an existing one it fills only the
storefront fields that are empty. `migrate:company` adds `website`, `openingHours` and
`social` from the legacy `companies` document — five profiles on `sen-tuan`, each kept only
when its address is an absolute `http(s)` URL. `company.shortName`, `fax`, `logo`, `favicon`,
`banner` and `mapEmbed` still have no v2 field and are reported by name.

Applied to `sen-tuan`: `websiteUrl`, both opening-hour locales and five social links written,
then `migrate:settings --apply` filled the remaining empty fields — `footerText`, `copyright`
and `keywords` — while the website URL kept the company document's real site rather than the
CMS domain in `system_configs.website_url`.
`check:migration` prints `✅ storefront settings 4/4 groups filled`.

Runtime check on `:4006` against `sen-tuan`: `GET /api/public/site?locale=vi` returns the
`site` block (`footerText: "© 2026 Sen Tuấn CMS. All rights reserved."`, both opening-hour
strings, five social links), and the server-rendered home page contains that footer line, the
Vietnamese opening hours and `https://zalo.me/0901593666`, so the data reaches HTML and not
only the JSON. The CMS settings page gained the matching fields; its social list is edited by
a small `SocialLinksEditor` component, because a type-generic Nuxt UI field repeated inside a
`v-for` loses the row scope in `vue-tsc` (the component uses plain inputs instead).

Gates: `pnpm typecheck`, `pnpm lint`, `test:web-site` **28 checks**, `test:settings` **11 checks**.

### CRM, inventory, purchasing, quotations, payments — migrated

`pnpm migrate:crm --site <customerId> [--apply] [--identity-map <file>]` copies
`customer_segments` → `crm_customer_segments`, `suppliers` → `crm_suppliers`, `warehouses` →
`crm_warehouses`, `inventories` → `crm_inventories`, `purchase_orders` → `crm_purchase_orders` and
`quotations` → `crm_quotations`, `payment_transactions` → `crm_payments`. Dry run by default, matched on the business key (`code`, or
item+variant+warehouse for a stock balance) so a rerun updates instead of duplicating, and nothing
legacy is deleted. References resolve through the migrated data: a legacy item id maps to
`catalog_items.legacyId`, a warehouse/supplier id to the row written in the same run, and a variant to
its SKU (v2 keeps variant SKUs, not legacy variant ids).

Status vocabularies differ, and the mapping is printed: purchase order `completed` → `received`,
quotation `submitted` → `sent`, and a cancelled quotation → `rejected` (v2 has no quotation
`cancelled` state).

Applied to `sen-tuan`: segments 2/2, suppliers 3/3, warehouses 3/3, inventory 49/49, purchase orders
6/6, quotations 3/3, payments 1/1; a second run writes the same rows and the re-read verification
passes. A legacy payment keeps its purchase order reference (`referenceCode` resolved to the migrated
`crm_purchase_orders` id), its direction (`out` → `payable`), its allocation list and its posting state.

`migration:mapping` now prints a field-level matrix for the same seven domains (source field, target,
transform, rows carrying it on each side, verdict). On `sen-tuan` every comparable field is `ok`; the
two exceptions carry the reason instead of a bare failure — `purchase_orders.supplierId` 6 → 0 (the
legacy supplier ids no longer exist in `suppliers`) and `quotations.customerId` 3 → 0 (customers have
no Hub subject yet). A domain whose row counts differ prints "not comparable" rather than a table
that would read as a lost field.

The command also reported, instead of hiding: 6 purchase orders whose `supplierId` no longer exists in the
legacy `suppliers` collection (stored `null`), 3 quotations whose customer is not migrated (stored
`null`), legacy fields with no destination (`purchase_orders.createdBy`, `quotations.history`,
quotation line `importPrice`/`supplierId`).

`check:migration` now counts these domains, so `✅ parity` covers them; a gap prints under
`still to import:`.

After these changes `pnpm verify:all` on the isolated `tm-websites-audit` database is green again:
**67/67 gates in 342.7s** (exit 0), and `pnpm typecheck` / `pnpm lint` exit 0.

### Document templates — migrated (2026-11-24)

`pnpm migrate:document-templates --site <customerId> [--apply]` carries the legacy
`document_templates` collection (quotation print templates) into
`crm_document_templates`: name, code, type, isDefault, primaryColor, showLogo,
all show* flags, company block, terms and signature titles. Dry run by default,
upsert by (siteId, code), and keeps a single default per type. Model, service
(CRUD + soft delete/restore + `getDefault`), admin API routes under
`/api/v1/admin/commerce/document-templates`, and model registration landed.
Quotation print still uses its built-in sheet; template selection is open.

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

`system_configs` 69 / `system_datas` 117 / `system_routes` 202 (no target model; the content
keys now land in `settings.site`, the rest are credentials, infrastructure or UI toggles v2 does
not model), finance, HR, `document_templates` and `connects` (Hub-owned).
