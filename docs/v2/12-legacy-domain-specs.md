# 12 — Legacy domain specifications

Extracted read-only from [nuxt4-cms](../../../nuxt4-cms) and [nuxt4-website](../../../nuxt4-website) on 2026-11-07. Purpose: give an implementer the real route/API/model/enum surface, so the rebuild preserves behavior without copying defects.

**Read this as reference material, not target design.** Where a legacy behaviour is unsafe or inconsistent it is marked `DO NOT PORT` with the reason. Path-only indexes: [legacy-feature-paths.json](legacy-feature-paths.json).

---

# Part A — Legacy website (`nuxt4-website`)

Stack: Nuxt 4, `@nuxt/ui` 4, Mongoose, Pinia, `@nuxtjs/i18n`, `@nuxtjs/turnstile`, `@vite-pwa/nuxt`, `@nuxtjs/sitemap`, `@nuxtjs/robots`, `@nuxt/og-image`.

## A1. Public pages

| Page | Data source | Notes |
| --- | --- | --- |
| `app/pages/index.vue` | `GET /api/v1/public/home` (key `home-data`) | Sections `TrendingProducts`, `LatestProducts`, `SaleProducts`, `FeaturedNews`, `NewsGrid`, `LatestNews`, `Newsletter` gated by `enabledModules` / `home_*_enabled` |
| `app/pages/[...slug].vue` | `GET /api/v1/public/resolve/:slug` | `definePageMeta({ key: route.fullPath })`, module gate via `moduleTypeMap`, renders `RenderDynamicLayout`; owns `useHead`/`useSeoMeta` |
| `app/pages/cart.vue` | Pinia only | No server cart |
| `app/pages/checkout.vue` | `POST /api/v1/public/commerce/checkout` | Client Turnstile component |
| `app/pages/search.vue` | `GET /api/v1/public/discovery/search` | Tabs: all / products / categories / posts / pages |
| `app/pages/tag/[slug].vue` | `GET /api/v1/public/discovery/tag-detail` | Cursor append, `limit=12` |
| `app/app.vue` | `GET /api/v1/public/system/bootstrap`, lazy `/system/layout` | Global SEO via `usePageSeo().setupGlobalSeo()` |

Error shell: `app/error.vue` renders `UError`.

## A2. Public API surface

All routes are wrapped by `cachedEventHandlerDB` (`server/utils/eventHandlerDB.ts`): connects Mongo, then `cachedEventHandler` with `maxAge` / `staleMaxAge` / `swr` / `getKey`. CORS `*` via `server/middleware/0.cors.ts`.

| Method | Path | Purpose | Cache (max/stale) |
| --- | --- | --- | --- |
| GET | `/api/v1/public/resolve/[...slug]` | Slug resolution | 300/3600, swr, key `event.path` |
| GET | `/api/v1/public/home` | Home sections | 600/1800 |
| GET | `/api/v1/public/system/bootstrap` | Config + company + menus | 600/1800 |
| GET | `/api/v1/public/system/layout` | Header/footer categories | 3600 |
| GET | `/api/v1/public/products` | List: `category,page,cursor,limit,sort,minPrice,maxPrice` | 60/600 |
| GET | `/api/v1/public/products/related` | `id,categories,limit` | 300/3600 |
| GET | `/api/v1/public/products/[slug]` | Product detail | 300/900 |
| GET | `/api/v1/public/product-category/items` | `ItemCategory` by `parent` | 600/3600 |
| GET | `/api/v1/public/posts` | List; **400** when both `category` and `tag` are absent | 60/300 |
| GET | `/api/v1/public/discovery/search` | `q,type,page,cursor` | **uncached** |
| GET | `/api/v1/public/discovery/tag-detail` | Tag + four result sets | **uncached** |
| GET | `/api/v1/public/discovery/popular-tags` | Popular keywords | 3600/7200 |
| GET | `/api/v1/public/tags/popular` | Duplicate of the above | 3600/7200 |
| POST | `/api/v1/public/commerce/checkout` | Proxies to `cms_url + /api/v1/public/commerce/checkout` | uncached |
| POST | `/api/v1/public/forms/contact` | Sends mail via Google OAuth token stored in `Connect{key:'google'}` | uncached |
| POST | `/api/v1/public/forms/newsletter` | Sends a welcome mail only | uncached |
| GET/POST | `/api/v1/demo`, `/api/v1/demo/users` | Static scaffolding | uncached |

Internal: `GET /api/_internal/cache-keys` (dev-only 403 guard), `POST /api/_internal/purge-all`, `POST /api/_internal/purge-cache`.

Legacy routes that must **not** be reproduced: `/api/v1/demo*` and the duplicate `tags/popular` alias (keep one contract, and only if a consumer needs it).

## A3. Collections and projections

Public readers touch: `contents`, `content_categories`, `items`, `item_categories`, `keywords`, `companies`, `menus`, `menu_items`. `orders` and `carts` are never read by the website.

### Public-projection defects — DO NOT PORT

These are confirmed source-level leaks; the rebuild must use explicit allowlists.

1. `ITEM_PROJECTION` in `server/services/site.resolver.service.ts` includes `lastImportPrice`, `tenantId` and the **entire** `variants[]`, exposing `supplierPrices[]` (`supplierId`, `price`), `lastImportPrice`, `reserved`, `minStock`.
2. `getProductDetail`, `getRelatedProducts` (partially), `discovery/search` and `tag-detail` apply **no `select`**, returning whole documents: supplier prices, import prices, `history` (with actor id and IP), `searchString`, `isDeleted`.
3. `/system/bootstrap` returns the full `Company` document including `bankAccounts` (account number, owner, QR) plus public config keys `cms_url`, `firebase_*`, `vapid_public_key`. Internal service URLs are not public configuration.

Any rebuild row touching products/content must add a projection test asserting these fields are absent from the response.

## A4. Slug resolver

`server/services/site.resolver.service.ts`, exposed by `GET /api/v1/public/resolve/[...slug]`.

Resolution order:

1. Virtual `news` / `tin-tuc` → `{ type: 'post_category', subtype: 'post', data: { _id: 'all' } }`.
2. Virtual `products` / `san-pham` → `{ type: 'item_category', subtype: 'item' }`.
3. `tag/…` or `the/…` prefix → `keywords` → `{ type: 'tags' }`.
4. Parallel lookup on `{[fullPath|slug].{vi,en}}` with `isDeleted:false`, in order: `item` → `content` (`page`/`post`, with `format`) → `item_category` → `content_category` (`news` → `post`) → `keywords`.
5. Search set is `{ fullSlug, lastSegment }`.
6. Item requires `status:'published' && isActive`; content requires `published`.
7. No match → 404.

Target rules to preserve: deterministic discriminator, collision priority in the order above, virtual category routes, tag routes, unpublished/deleted exclusion, real HTTP 404.

`DO NOT PORT`: the resolver never returns a redirect. `[...slug].vue` contains a `type === 'redirect'` branch that is unreachable, while the CMS still writes a `Redirect` collection (`Content.ts`, `ContentCategory.ts` pre-save hooks). The rebuild must either implement redirects deliberately or drop the unused model.

## A5. Resolver/render mismatches to fix, not copy

1. `moduleTypeMap` keys `product` / `product_category` are never produced; the resolver emits `item` / `item_category` / `tags`, which are absent. Result: disabled `products` module still serves item pages.
2. `DynamicLayout` falls back to `post` for unknown types; there is no `redirect` renderer.
3. Two tag entry points overlap: `tag/[slug].vue` and the `[...slug]` `/tag|/the` prefix. `type:'tags'` carries no `subtype`/`format`.
4. The resolver can return `content.type` of `item`, `project` or `service`, while `DynamicLayout` only knows `post` and `page`.
5. The product list price filter queries `salePrice` only, silently excluding items without a sale price.

The rebuild needs one discriminator contract, one renderer map, and tests asserting every emitted type has a renderer and vice versa.

## A6. Cart and checkout

`app/stores/cart.ts` (Pinia `persist: true`):

```text
CartItem { id, title, slug, thumbnail, price, quantity, variant?{ sku, attributes } }
price = variant.salePrice || variant.basePrice || product.salePrice || product.basePrice
```

`variantId` is sent as the variant **SKU string**, while `Order`/`Cart` schemas type it as `ObjectId` — an existing bug.

Checkout payload:

```text
{ shippingAddress{fullName,email,phone,street,city},
  items[{ itemId, variantId, quantity, price, itemName, thumbnail }],
  paymentMethod: 'cod' | 'bank' | 'card',
  note, token }
```

`DO NOT PORT`: the website performs **no repricing, no stock check, no price validation, and no server-side cart persistence**; it forwards client prices verbatim to the CMS. `paymentMethod:'card'` is only a label — there is no gateway integration.

The rebuild must re-read item/variant price, availability, stock and totals server-side, reject unknown variants, and use an idempotency key.

## A7. Forms and anti-abuse

- Contact: `{name,email,subject,message}`; requires `email` and `message`; interpolates user text as raw HTML into an outgoing email (injection risk); no persistence, no rate limit, no CAPTCHA.
- Newsletter: `{email}` only; sends a template email; **no subscriber record is stored**.
- Turnstile: configured and rendered in checkout, but **no `siteverify` call exists anywhere** — the token is checked only for presence in the browser.

Target: verify Turnstile server-side, never template user input into HTML mails, persist leads/subscribers with consent, and rate-limit public commands.

## A8. SEO and i18n

- `usePageSeo`: `titleTemplate` "Page | Company"; canonical from `company.website_url + route.path`; hreflang via `getAlternateLinks` (vi unprefixed, other locales `/xx`, plus `x-default`); OG/Twitter/robots from `company.seo`; OG image via `defineOgImage`.
- Sitemap: `@nuxtjs/sitemap` with only `exclude:['/admin/**']` and no dynamic source; prerender is limited to `/robots.txt` and `/sitemap.xml` with `crawlLinks:false`.
- Robots: disallows `/admin` only.
- **No JSON-LD / structured data anywhere.**
- i18n: `vi` (default, `vi-VN`) and `en` (`en-US`), `strategy:'prefix_except_default'`, `detectBrowserLanguage:false`. Content locale is separate (`content_locale` from config, cookie `content-locale`).
- **Unsafe**: the resolve cache key is `event.path` while `useFetch` keys include locale — a locale-independent cache key can serve one language's payload for another.

The rebuild should choose one locale model explicitly (URL prefix or cookie), state it in [06](06-ui-and-storefront.md), and include locale in every cache key.

## A9. PWA (legacy)

`@vite-pwa/nuxt` with `registerType:'autoUpdate'`, manifest `start_url:'/'`, `display:'standalone'`, icons 192/512 + maskable, workbox `navigateFallback:'/'` with denylist `/^\/api/`, static assets only, no offline page, `devOptions.enabled:false`.

`DO NOT PORT`: a universal `/` navigate fallback for an SSR storefront returns the home document for every offline navigation. The current rebuild already uses a custom worker with a dedicated offline page; keep that approach and verify it in a browser.

## A10. Cache purge (legacy)

- `POST /api/_internal/purge-cache` body `{secret, tag?, key?, slugs?}`; `POST /api/_internal/purge-all` body `{secret}`.
- Secret compared with plain inequality against `config.revalidate_secret`.
- Purge deletes keys from `useStorage('cache')` containing `nitro:handlers:`; `tag` maps to hardcoded key substrings (`tagMap`); `key`/`slugs` are normalized by stripping `[-/]` then substring-matched.
- `cachedEventHandlerDB` **ignores** its `tag` option, so the Nitro tag registry is unused.

Limits that must not be inherited:

1. `REVALIDATE_SECRET` had a committed default in `nuxt.config.ts` — the rebuild must have no secret default and must reject an empty secret (the current `tm-web` endpoint already returns 503 when unconfigured).
2. Substring purge over the local Nitro cache does not invalidate CDN/ISR or other instances.
3. No replay protection or payload signature.

Target contract is in [06 — cache and invalidation](06-ui-and-storefront.md#cache-and-invalidation).

---

# Part B — Legacy CMS (`nuxt4-cms`)

Nuxt 4 SPA (`ssr: false`) + Nitro. Observed scale: 94 pages in `app/pages`, 369 route files in `server/api`, 44 models in `server/models`, 28 services in `server/services`. Domain enums live in `shared/utils/constants.ts`, re-exported through `server/models/Schemas.ts`.

Conventions to know before reading the tables:

- Timestamps are numeric epochs (`timestamps: { currentTime: () => Date.now() }`).
- Soft delete uses `isDeleted` / `deletedAt`.
- Audit exists twice: embedded `history: [ChangeDataSchema]` and a separate `histories` collection (`server/services/history.service.ts`). The rebuild should pick one model, not copy both.
- Business codes come from `generateCodeCounter` with prefixes `ORD`, `QUO`, `PO`, `PT`, `PMT`, `INV`, `CUS`, `SHP`.
- Numeric money fields have no decimal/minor-unit contract; see [04](04-data-and-api.md) for the target rule.

## B1. Catalog

Pages: `app/pages/products/{index,items/*,categories,attributes,options,keywords,pricing}.vue`.

API `/api/v1/admin/products/*`: item CRUD + `list.post` (cursor), `check.post` (sku/barcode/slug uniqueness), `[id]/history`, `[id]/serials`, `[id]/variants`, `variants/[variantId]`, `items/[id]/supplier-price.post`, `suggestions`, `supplier-comparison`, `suppliers`; `categories/*` (incl. `check`, `order`, `history`); `attributes/*`; `options/*`; `keywords/*`; `pricing` POST (search) / PATCH (bulk). Plus `/api/v1/admin/inventory/sku.get`.

`Item` fields that matter: localized `Map` for `title|slug|fullPath`; `categories[]`; `sku`; `basePrice` (required); `salePrice`; `lastImportPrice`; `supplierPrices[{supplierId,price,currency,supplierSku,moq,leadTime,isPreferred}]`; `prices[{k,v}]`; `stock`; `reserved`; `minStock=5`; `manageStock`; `hasImei`; `options[{title,code,ui_type,values[]}]`; `variants[{sku,barcode,qrCode,attributes,basePrice,salePrice,lastImportPrice,supplierPrices,stock,reserved,minStock,hasImei,thumbnail,shipping{weight,length,width,height}}]`; `type`; `status`; `attributes[]`; `display{flags,priority,showOnHome}`; `searchString`.

Enums: `type=['simple','variable']`; `status=['draft','published','scheduled','archived']`; option `ui_type=['text','color','image','dropdown','radio']` (+`checkbox` on `Option`); `Keywords.type=['tag','keyword','hashtag']`, `Keywords.scope=['item','content','share']`.

Indexes worth preserving (as intent, re-derived for the new schema): partial-unique `sku`, `barcode`, `variants.sku`, `variants.barcode` when non-empty; text index on `searchString`; wildcard `fullPath.$**` and `slug.$**`; `categories+isActive+isDeleted`; `sales:-1`; `stock+isActive`; `supplierPrices.supplierId`; `Attribute` unique `(title,type)` and `(slug,type)`; `Keywords` unique `(slug,type)`.

Invariants: virtual `quantityAvailable = max(0, stock - reserved)`; slug/`fullPath` regenerated in `pre('save')` from title + category path under config `url_mode` (`flat|prefix|category`); duplicate SKU/barcode within one item rejected; variant `basePrice` inherits parent when `0`; `getBestSupplier()` picks the lowest price.

Rebuild note: wildcard uniqueness is asserted in `pre('save')`, not by the database — a concurrent insert can bypass it. Use a unique partial index or a transaction.

## B2. Content

Pages: `app/pages/content/{index,pages/*,posts/*,categories,attributes,keywords}.vue`; public render `app/pages/[slug].vue`.

API `/api/v1/admin/content/{pages,posts}`: list, create, `list.post`, PATCH (bulk), DELETE (batch by comma ids), `check.post`, `order.put`, `[id]` GET/PUT/DELETE, `[id]/history`; `categories/*` mirrors with `check/order/history`.

`Content` fields: `type`, `format`, localized `title|slug|fullPath|content|excerpt`, `parent`, `template`, `gallery[]`, `media[{type,url,…}]`, `quote{text,author}`, `linkUrl`, `author{userId,name,avatar,url}` (snapshot), `source`, `categories[]`, `tags[{title,slug}]`, `attributes[{g,k,v}]`, `seo{title,description,keywords,image,ogType,robots}`, counters, `publishedAt`, `scheduledAt`, `expiredAt`, `sort`, `display{flags,priority,showOnHome}`, `searchString`.

Enums: `Content.type=['post','page','item','project','service']`; `format=['standard','gallery','video','audio','quote','link','dynamic']` (these are the seven editorial formats); media `type=['video','audio','iframe','embed']`; `status=['draft','published','scheduled','archived']`; `display.flags` is a free string array documented as `['featured','hot','new']`.

Invariants: setting `status='published'` fills `publishedAt` when empty; system fields stripped on update; tags/keywords/attributes synced into global collections when `sync_keywords_mode`/`sync_attributes_mode='db'`; author snapshot written on create.

**Gaps that must be closed, not copied:** `scheduled` and `expiredAt` are never enforced anywhere (no scheduler); `item|project|service` content types exist but the public renderer only knows `post|page`; `display.flags` is unvalidated free text.

The current rebuild models `page|post|fragment` with `draft|scheduled|published|archived|deleted`, which is a deliberate narrowing — reconcile the missing legacy types in the parity matrix rather than silently dropping them.

## B3. Commerce

Pages: `app/pages/commerce/{orders/*,pos,quotations/*,customers/*,segments}`, portal `app/pages/customer/{index,items,cart,checkout,orders/*,quotations/*}`.

API: orders CRUD + `list.post`, `[id]/{confirm,cancel,ship,update-status,payments,history}`, `orders/return.post`, `pos/{checkout,search}.post`; quotations GET/POST/`list.post`/`product-search.post`, `[id]`, `convert.post`, `history`; customer portal `cart` GET/POST/PUT/DELETE, `checkout.post`, `orders` + `cancel.post` + `[id]/tracking`, `quotations` GET/POST/`[id]`; public `v1/public/commerce/checkout.post`.

`Order`: `code` unique, `customerId`, `userId` (operator), `warehouseId`, `orderStatus`, `shippingAddress`, item snapshots `{itemId,variantId,supplierId,itemName,sku,attributes,price,quantity,thumbnail}`, `itemsPrice`, `shippingFee`, `discountAmount`, `totalAmount`, `currency='VND'`, `paymentStatus`, `paidAmount`, `paymentMethod`, `channel`, `bankingDetails`, `shippingInfo{…}`.

Enums: `ORDER_STATUSES=['pending','processing','shipped','completed','cancelled']`; `PAYMENT_STATUSES=['unpaid','paid','partial','refunded']`; `PAYMENT_METHODS=['cash','banking','cod','card','other']`; `TRANSACTION_SOURCES=['pos','portal','admin','import']`; `QUOTATION_STATUSES=['draft','submitted','quoted','revision_requested','confirmed','converted','rejected','expired','cancelled']`.

Enforced transitions (`commerce.service.ts`):

- create → `pending` / `unpaid`.
- `confirmOrder`: only `pending → processing`.
- `shipOrder`: only `processing → shipped`; releases reservation, then `modifyStock(-qty,'export')`.
- `completeOrder`: only `shipped → completed`; auto-creates a `cash` `PaymentTransaction` if none exists.
- `cancelOrder`: rejected for `shipped|completed` and when already `cancelled`.
- `updateOrderDiff`: rejected for `shipped|completed|cancelled`.
- Customer cancel: requires `pending` **and** ownership.

Quotation: admin create with `action=draft|send_quote|confirm`; portal `draft|submitted`; customer `confirm` only from `quoted`; `request_revision` only from `quoted` (bumps `version`); `submit` only from `draft`; edit only in `draft`; `convertToOrder` requires `confirmed` with no `convertedOrderId`.

**Defects not to port:**

1. `returnedQuantity` is written on return but is not declared in the `Order` schema, so strict mode drops it and the "quantity − returnedQuantity" cap never accumulates — repeated returns can exceed the sold quantity. Sets `paymentStatus='refunded'` wholesale and writes an `out/refund` transaction.
2. POS `checkoutPos` bypasses reservation entirely: order created `completed/paid`, stock deducted directly, guest allowed with `customerId=null`.
3. Line price is `payload.price || variant.salePrice || …` — the client-supplied price wins.
4. `expired` is in `QUOTATION_STATUSES` but nothing ever sets it; `validUntil` (default +7 days) is never checked.
5. `CustomerSegment.defaultDiscountPercent` / `freeShipping` are never applied at cart or checkout.

## B4. Inventory

Pages: `app/pages/inventory/{index,stock/*,warehouses}.vue`.

API `/api/v1/admin/inventory`: `stock` GET/POST (`adjust|transfer`), `stock/list.post`, `stock/[id]`, `transactions`, warehouses CRUD + `check`/`sort`/`[id]/staff`/`history`, `sku.get`.

Models: `Inventory` (`itemId`, `variantId`, `warehouseId`, `sku`, `quantityOnHand`, `quantityReserved`, `binLocation`, `lowStockThreshold`; **unique** `(itemId,variantId,warehouseId)`); `InventoryTransaction` (`code`, `inventoryId`, `type`, `quantityChange`, `previousQuantity`, `newQuantity`, `unitCost`, `totalValue`, `imeiCodes[]`, `referenceId` required, `referenceCode`, `referenceModel`, `reason`, `performerId`); `ItemSerial` (`code` unique, `status`, `importPoId`, `soldOrderId`, `soldToCustomerId`, warranty); `Warehouse` (`code` unique, `status`).

Enums: `INVENTORY_TRANSACTION_TYPES=['import','export','return_in','return_out','transfer_in','transfer_out','adjustment_inc','adjustment_dec']`; `INVENTORY_REF_MODELS=['PurchaseOrder','Order','InventoryTransfer','InventoryAdjustment']`; `ItemSerial.status=['available','sold','transferring','defective','returned']`.

**Defects not to port:**

1. `reserveStock` only `$inc quantityReserved` with **no availability check** — over-reservation is possible.
2. `modifyStock` does not guard against negative quantities.
3. Transfers are inline in `stock/index.post.ts` as `transfer_out` + `transfer_in` with two **random** `referenceId` ObjectIds; no `InventoryTransfer` model exists, so references dangle.
4. No stocktake model or endpoint at all.
5. `ItemSerial` has **no writer** — only reads; PO receipt pushes to `Item.imeiItems`, a field absent from the schema, silently dropped by strict mode.

## B5. Purchasing

Pages: `app/pages/inventory/{suppliers,purchase-orders/*}.vue`; supplier portal `app/pages/supplier/index.vue`.

API: PO GET/POST, `[id]` GET/PUT/DELETE (`PUT` dispatches `action=place_order|start_receive|reconcile|complete|cancel`); suppliers CRUD + `check`/`sort`/`history`/`[id]/items`; portal `v1/supplier/{dashboard,items}`.

`PurchaseOrder`: `code` unique, `supplierId`, `warehouseId`, items `{itemId,variantId,sku,title,quantity,orderedQuantity,processedQuantity,receivedQuantity,rejectedQuantity,purchasePrice,price,note,imeiCodes[]}`, `totalAmount` (actual), `orderedTotalAmount` (estimate), `status`, payment fields, `expectedDeliveryDate`, `reconcileNote`, `createdBy`.

Enums: `PURCHASE_ORDER_STATUSES=['draft','ordered','receiving','pending','completed','cancelled']`.

Flow: `placeOrder` `draft→ordered`; `startReceiving` `ordered→receiving`; reconciliation allowed from `receiving|pending`; `completePurchaseOrder` requires reconciliation, applies the **delta** `receivedQuantity - processedQuantity` (so partial receipts are idempotent), upserts `Inventory`, writes `import` transactions, updates `Item.lastImportPrice` and `supplierPrices`, optionally creates `out/purchase` payment, then sets `completed` if every line reached `orderedQuantity`, else `pending`. `cancel` only from `draft|ordered`.

This delta-based receipt is the one legacy invariant worth preserving exactly; it is the only idempotent partial-receipt handling in the codebase. It silently degrades to non-transactional writes when the server has no replica set — the target must fail closed instead.

## B6. Finance

Pages: `app/pages/finance/{index,center,payments,transactions,debts,reports}.vue`.

API: `payments` GET, `payments/webhook.post`, `transactions` GET/POST, `reports/{index,stats,revenue-chart,pnl,debt-details,top-debtors,top-products,categories,inventory,inventory-value,partner-transactions}`.

Models: `PaymentTransaction` (ledger: `code`, `amount`, `type`, `category` free string, `source`, `referenceId/Model/Code`, `partnerId/partnerType`, `method`, `status`, `note`, `bankingDetails`, `createdBy`); `Payment` (gateway attempt: `code`, `orderId`, `customerId`, `method`, `amount`, `currency`, `status`, `gatewayTransactionId`, `gatewayResponse`, `paymentUrl`, `paidAt`, `expiredAt`).

Enums: `TRANSACTION_TYPES=['in','out']`; `TRANSACTION_STATUSES=['pending','completed','failed']`; `PARTNER_TYPES=['Customer','Supplier','Employee','Other']`; `REF_MODELS=['Order','PurchaseOrder','Other','None']`; `PAYMENT_TYPES=['debt','now','partial']`; `PAYMENT_GATEWAY_METHODS=['cod','banking','momo','stripe','paypal']`; `PAYMENT_GATEWAY_STATUSES=['pending','processing','success','failed','refunded','expired']`.

Invariant worth keeping: `transactionService.create` recomputes `paidAmount`/`paymentStatus` from **completed** transactions only (`in` for Order, `out` for PurchaseOrder).

Defects: `category` is an unvalidated free string; debt aggregation filters a status `partial` that is not a valid order status (dead branch); no reversal model (payments are not corrected, only added); the gateway attempt model exists but no real gateway integration was verified.

## B7. HR

Pages: `app/pages/hr/{index,staff,attendance,payroll}.vue`.

API: `hr/staff` CRUD + `[id]/history`; `hr/salary` GET/POST + `[id]/history`; `hr/attendance` GET only; `hr/payroll` GET only.

Models: `StaffProfile` (`userId` unique, `positionCode`, `jobDescription`, `workStatus`); `Attendance` (`userId`,`date` `YYYY-MM-DD`, `checkIn`, `checkOut`, `status`, `warehouseId`; unique `(userId,date)`); `SalaryConfig` (`userId` unique, `baseSalary`, `allowances[]`, `effectiveDate`); `Payroll` (`userId`,`month`,`year`,`totalWorkDays`,`calculatedSalary`,`status`; unique `(userId,month,year)`).

Enums: `workStatus=['probation','official','resigned']`; attendance `['present','late','leave']`; payroll `['pending','paid']`.

Reality check: `hr.service.markPayrollAsPaid` rejects double-pay and writes an `out/salary` transaction, **but no endpoint calls it**. There is **no shift/schedule model**, no attendance or payroll write endpoint, and no salary→payroll calculation. HR is therefore mostly read-only scaffolding — the parity row HR-01 is closer to "not implemented" than the page count suggests.

## B8. CRM

Pages: `app/pages/commerce/{customers/*,segments}`, portal `app/pages/customer/*`.

API: customers CRUD + `list.post` + `[id]/history`; `segments/sort.put`; `v1/customer/dashboard`.

`Customer`: `userId` unique, `code` unique, `addresses[{isDefault,title,recipientName,phone,street,ward,city,country,sort}]`, `customerSegment`, `loyaltyPoints`, `metrics{totalOrders,totalSpent,lastOrderAt}`, `isActive`, `note`. `CustomerSegment`: `title`, `code` unique, `defaultDiscountPercent`, `freeShipping`, `autoJoinCriteria{minSpent,minOrders}`, `sort`.

`customer.service.createCustomer` always creates a local `User` **plus** a `Customer`. That local identity store is exactly what Hub replaces: the rebuild keeps the business `Customer` record, links it to a Hub subject, and drops local credential creation. `metrics` are never updated by order flows; the detail endpoint recomputes totals by aggregation and takes `max(stored, computed)` — a workaround for the missing update path.

## B9. Settings and system

Pages: `app/pages/settings/{company,connect,mail,media,menu,shipping}`, `app/pages/system/{config,data,import,roles,routes,users}`, `app/pages/root/{seed,recalc}`, `app/pages/profile`.

API: company GET/POST + `history`; `connect` CRUD + `[id]/{auth,callback,token,history}`, `disconnect`, `status.put`; `mail` GET/`[id]`/DELETE/`send.post`; `shipping` GET/POST, `[code]` PUT, `disconnect`, `status.put`; `config` GET/POST/`list`/`defaults`/`[key]`/`[id]/history`; `data` CRUD/`list`/`sort`; `import` GET/POST; `roles` CRUD/`check`/`sort`/`history`; `routes` CRUD/`list`/`order`/`history`; `users` CRUD, `check`, `status.patch`, `[id]/{change-password,reset-password,sessions,staff-profile,history}`, `authors.post`; root `seed/{index,[module]}` POST/DELETE, `recalc`.

Models: `Company` (localized name/address/social/bankAccounts/seo); `SystemConfig` (`key` unique, `value`, `type=['string','number','boolean','json','image']`, `inputType`, `isPublic`, `group`, `subGroup`, `options`, `sort`); `SystemData` (unique `(type,code)`; seeded types include `uom,currency,order_status,payment_method,transaction_category,user_type,item_pricing,price_type,menu-*,content_*,import_template,office,social`); `SystemRoute` (`path`,`name` unique, `label`, `icon`, `permissions[]`, `parent`, `isVisible`, `sort`); `Role` (`code` unique, `allowedRoutes[]`, `types[]`, `isDefault`); `Menu` (`position`, `settings.permissionType`); `MenuItem` (`type`, `refId` via `refPath`); `History` (`docId`,`modelName`,`action`,`changes`,`by{_id,name,username,avatar}`, indexes `(docId,modelName,at:-1)`); `Redirect` (unique `(tenantId,oldPath)`); `UserSession` (refresh token TTL index); `WebAuthnCredential`.

Rebuild split: `SystemConfig`/`SystemData`/`Company`/`Menu`/`Redirect`/`DocumentTemplate` are business data → MongoDB. `Role`, `SystemRoute`, `UserSession`, `WebAuthnCredential`, and user credentials belong to Hub and must **not** be recreated locally. `allowedRoutes`-derived permissions must be replaced by the Hub permission contract in [03](03-hub-auth.md).

Import supports `items|item_categories|posts|pages|post_categories` keyed by `sku`/`slug` with reference resolution and `autoFixSlug`; serial import is explicitly unimplemented.

## B10. Media, mail, notifications, connections, shipping

Pages: `settings/{media,mail,connect}`, `notifications`, `notify`.

API: media `admin/media/config`, `media/items.post`, `media/cloudinary/{signature,files,folders,…}`; mail under `admin/settings/mail/*`; notifications `admin/notifications` + user `v1/notify` (+ `read-all`, `[id]/read`, `subscribe`, `unsubscribe`), `auth/profile/fcm-token`.

Models: `Media` (`filename`,`path`,`mimetype`,`size`,`type=['image','video','document','other']`,`ownerId`,`metadata`,`isPublic`); `NotificationTask` (`recipientType=['all','role','users']`, `correlationId` unique sparse, `stats`); `Notification` (`recipientId`,`taskId`,`isRead`); `Connect` (`key` unique, `provider`, `clientID`, **`credentials` raw object**, `isConnected`).

Integrations verified in source: Cloudinary signed direct upload; Google OAuth for Gmail send and Drive/Sheets/Docs read; notification providers `firebase|mongodb` plus Web Push (VAPID); Cloudflare Turnstile on public checkout; carriers `viettel_post`, `vnpost`, `spx_express` (HMAC `X-SPX-Signature`) with `SHIPMENT_STATUSES=['ready_to_pick','picking','picked','in_transit','out_for_delivery','delivered','delivery_failed','returning','returned','cancelled']`.

`DO NOT PORT`: `Connect.credentials` stores provider secrets as a plain object in a business collection. The rebuild needs a server-only secret store (or envelope encryption) and must never return credential values through settings APIs.

## B11. Legacy authorization patterns — MUST NOT be ported

Verified in source on 2026-11-07:

1. **Development root bypass.** `server/middleware/1.auth.ts` injects `{ userId: 'system-seed', isRoot: true }` for `/api/v1/root/seed/*` when `NODE_ENV === 'development'`, and `auth.service.ts` returns `true` for that literal id. Remove entirely; seeding must be an authorized operator action.
2. **Local JWT authority with hardcoded fallbacks.** `nuxt.config.ts` defines `jwtSecret` and `jwtRefreshSecret` with literal fallback values (also a default `revalidate_secret` and a default MongoDB URI). No value is reproduced here, and none may be carried over. Hub owns issuance.
3. **Access token readable by JavaScript.** `app/composables/system/useAuth.ts` mirrors the access token into a non-HttpOnly `useCookie('auth_token')`, and `server/middleware/1.auth.ts` accepts that cookie as a bearer credential. This allows XSS token theft and makes the session CSRF-able. Only the refresh cookie was HttpOnly.
4. **Coarse prefix permission matching.** `authService.hasPermission` does `startsWith` matching on API path prefixes from `allowedRoutes[].permissions`, so granting `/api/v1/admin/commerce` grants every child route and method, plus `'*'` bypass. No per-resource or tenant ownership check.
5. **Unprotected admin endpoints.** 307 admin route files exist, but only 124 reference `event.context.user`; six still carry a literal `TODO: Add authorization check` (e.g. inventory stock/transactions/warehouses). Warehouse scoping (`user.warehouseId`) is not enforced.

These are historical defects in a frozen reference project. They are documented so the rebuild does not reproduce them, and they are a reason P1/P2 gates are mandatory — not a claim about the current tm-websites code.
