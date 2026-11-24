# Owner decision packet — TM Platform migration

Prepared from local source (`nuxt4-cms`, `nuxt4-website`) and read-only local MongoDB (`sen-tuan`, `bag-post`). No secrets, raw customer data or production credentials are included. Each item lists evidence, options, recommendation and the exact information needed from the owner.

## Q11 — business API and server ownership

**Owner decision confirmed 2026-11-24: choose one business API owner (Option B).**

- CMS Nitro is the canonical owner of business MongoDB models, invariants, validation and write commands. Keep them in `tm-cms/server/`.
- Web remains a consumer: SSR and narrow public read projections may stay in `tm-web/server/`, but canonical business mutations must go through the CMS-owned API using server-side authorization bound to the verified app, tenant and site.
- Do not create or plan a shared server-only workspace package. Shared packages remain browser-safe contracts and pure utilities.
- Do not import `tm-cms/server/**` into Web and do not duplicate business write rules across hosts.

This closes Q11. Future extraction into a separately deployed service would require a new ADR and explicit owner approval.
## Q17 — checkout/order/payment scope

Evidence:

- Legacy has 4 checkout entry points (admin, portal explicit items, portal from cart, guest with Turnstile).
- Order state machine: `pending → processing → shipped → completed`, plus `cancelled`; `paymentStatus` separate (`unpaid/paid/partial/refunded`).
- Legacy gateway creation is a mock and uncalled; no Momo/Stripe SDK or credentials.
- Target already has client cart validation (`WEB-05`) but checkout is `Planned` (`WEB-06`, `COM-01`).

Options:

- A. Implement full checkout/order/payment parity now (admin + portal + guest + POS).
- B. Implement admin/POS order management first; keep public checkout blocked until payment provider and abuse policy are decided.
- C. Keep checkout out of scope for first replacement; storefront remains catalog/content only.

Recommendation: B. It restores core ERP value without forcing a payment provider decision; public checkout remains blocked by provider/abuse policy.

Needed from owner: whether public checkout must ship in the first replacement, and which payment methods/providers are actually used (cash/banking/COD only vs card/gateway).

## Q18 — contact/newsletter destination, consent and delivery

Evidence:

- `nuxt4-website` contact form sends email to company admin email via Gmail, with unsanitized HTML interpolation of user input.
- Newsletter handler sends a welcome email only; no durable subscription/consent lifecycle.
- Target `WEB-07` is `Planned`.

Options:

- A. Implement contact form only, with sanitized text, rate limiting and delivery status.
- B. Implement contact + newsletter with a durable subscription table, consent timestamp and unsubscribe.
- C. Defer both until a mail provider/destination is chosen.

Recommendation: A for first replacement; B only if owner wants newsletter management. Always sanitize input and avoid direct HTML interpolation.

Needed from owner: destination mailbox/provider, consent/retention policy, and whether newsletter subscriptions must be stored.

## Q19 — media storage, public origin and provider

Evidence:

- Legacy CMS uses Cloudinary (`CLOUDINARY_*` env vars; media model stores Cloudinary metadata).
- Target media service is local disk + Mongo metadata, app-generated public URL, 12/12 service tests pass.
- Cross-host public delivery is blocked because no shared public origin/provider is configured.
- `MED-01` is Partial.

Options:

- A. Keep local disk for single-host dev/CMS-only; use provider adapter for production.
- B. Adopt Cloudinary adapter to preserve legacy behavior and transforms.
- C. Adopt object storage (R2/S3) + CDN with signed/public URLs.

Recommendation: implement an adapter interface + fake provider tests now; defer provider choice until owner selects. Do not store provider secrets in Mongo.

Needed from owner: chosen provider and public origin, plus whether transforms/signed uploads are required.

## Q21 — background jobs, scheduling and cron

Evidence:

- No cron/queue implementation found in `nuxt4-cms` or `nuxt4-website` source.
- Target has manual retention command (`prune:retention`) and idempotency keys, but no scheduler.
- Content scheduling (`publishAt`/`unpublishAt`) exists in target model but no job runs it.
- OPS-01 retention is manual by design.

Options:

- A. Add a scheduler (cron/queue) for content publish/unpublish and retention.
- B. Keep scheduling manual/operator-driven for first replacement.
- C. Use external cron hitting secured endpoints.

Recommendation: C or B for first replacement; do not add a queue infrastructure without owner approval.

Needed from owner: which jobs must run automatically, frequency, retry policy, and hosting constraints.

## CRM ambiguities (see `docs/legacy-analysis/crm.md`)

1. Automatic segment assignment via `autoJoinCriteria`: legacy stores but never applies. Recommendation: remove unless owner confirms a rule.
2. Segment pricing fields (`defaultDiscountPercent`, `freeShipping`): never applied in legacy. Recommendation: defer unless owner confirms discount policy.
3. Customer hard delete vs anonymization. Recommendation: soft delete + anonymization; preserve order references.
4. `metrics.lastOrderAt`: populate transactionally on order completion. Recommendation: required in target.
5. Address `district` field: legacy has it, target schema omits. Recommendation: include if shipping requires it.

Owner input needed: confirm recommendations or choose alternatives.
