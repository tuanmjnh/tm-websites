# ADR 0002 — Owner decisions Q1–Q22 and D1–D5

## Status

Recorded on 2026-11-09. The owner closed every question in [`tasks/questions.md`](../../tasks/questions.md) by adopting the default written for it, and accepted the five self-made decisions (D1–D5) in section D of that file. Where a default was "defer" the decision *is* the deferral: the slice stays in the queue with a stated reason, not silently dropped.

No decision below invents data. The four facts that only the owner can supply stay `WAITING_INPUT` and are listed in [§4](#4-waiting_input-facts-with-no-workaround): production `TM_MONGO_URI`, Cloudinary credentials, Vercel credentials/domains, and a legacy data snapshot. Nothing is fabricated to stand in for them.

This record does not claim any phase is complete; phase status lives in [`tasks/todo.md`](../../tasks/todo.md).

## 1. Context

The queue had 22 owner questions open. Sixteen were written before P2/P3 landed, so several already described behaviour that exists; the rest were real forks with no safe default (payment provider, form delivery, public media origin). While they stayed open, slice selection was limited to cosmetic work inside already-built paths.

Adopting the documented defaults converts "unanswered" into "decided, with a known consequence". That is different from answering them with real values: most decisions below deliberately keep the current, conservative behaviour, and the ones that would need a provider account or a credential are recorded as waiting for that input.

## 2. Decisions

`RESOLVED` means the question will not be asked again and the recorded behaviour is the intended behaviour. `WAITING_INPUT` means the decision is made (don't build a substitute) but an external fact is still missing.

### Identity and access (P1)

| ID | Decision | Status | Effect |
| --- | --- | --- | --- |
| Q6 | Do not modify `tm-hub`. Session revocation stays out of scope for this repository; authorization relies on a short-lived access token plus the verified-context gate, and every document that mentions revocation states it is not instantaneous. | RESOLVED | No cross-repo contract change. No "verified revoke" claim anywhere. |
| Q7 | Keep the 7-day access/refresh cookie lifetime; the TOTP challenge cookie stays 5 minutes. | RESOLVED | Matches `tm-cms/server/utils/authSession.ts`; no change. |
| Q8 | CSRF protection stays `Origin` check + `SameSite=Lax`; no double-submit token. | RESOLVED | Matches the existing guard; no change. |
| Q9 | `TM_AUTH_MODE=mock` is refused in production (`503 AUTH_MODE_FORBIDDEN`); there is no production scenario that needs it. | RESOLVED | Matches `server/utils/context.ts`; no change. A production health check must still run with a real Hub. |
| Q10 | No passkey/OAuth UI in this round; it stays behind P9. | RESOLVED (deferred) | Password + TOTP only. |

### Data and tenancy (P2/P3)

| ID | Decision | Status | Effect |
| --- | --- | --- | --- |
| Q1 | Local MongoDB only. No production URI is configured, and no deploy target is assumed. | **WAITING_INPUT** (production `TM_MONGO_URI`) | `/api/health` reports `database: unconfigured` where the registry has no database; disposable test databases are used as before. |
| Q2 | `default`, `thanhtung` and `hoangvi` stay without a business database until names are supplied, so their business modules stay disabled. `sentuan` keeps `sen-tuan`. | **WAITING_INPUT** (database names) | No registry entries invented; those customers keep `database: unconfigured`. |
| Q3 | Keep the legacy database names (`sen-tuan`, `bag-post`). No renaming migration. | RESOLVED | Registry and data stay compatible with existing records. |
| Q4 | No legacy snapshot is available, so no migration dry-run exists. Migration code must not be written against invented fixtures. | **WAITING_INPUT** (legacy snapshot) | P10 stays Planned. |
| Q5 / Q22 | TM Hub stays the transitional source for the existing content/config/media records; nothing is exported or imported. | RESOLVED (deferred) | Hub-backed pages remain read-only references. Import becomes a P10 slice only if the owner later authorises an export. |
| Q11 | Do not create a shared `@tm/flow-server` package in this round. Models, invariants and commands stay in `tm-cms/server/`, which is the approved scope. | RESOLVED | No package, no move, no behaviour change. Reconsider only with an explicit request. |
| Q15 | AI Workspace is out of v2 scope. | RESOLVED | No AI surface is planned; existing Hub AI endpoints are untouched. |
| Q16 | Retention keeps 50 revision snapshots per record and 365 days of `audit_logs`; the command stays dry-run unless `--apply` is passed. | RESOLVED | Matches `retentionService.ts` defaults; limits 1–500 and 1–3650 days stay as guard rails. |
| Q14 | No deploy, no `vercel.json`/CI preparation, no domain work. Builds stay local. | **WAITING_INPUT** (Vercel token + domains) | Deploy remains out of scope; local builds are the only gate. |

### Architecture and infrastructure

| ID | Decision | Status | Effect |
| --- | --- | --- | --- |
| Q12 / Q21 | No durable queue, no cron, no worker. Cache invalidation stays the signed-secret purge endpoint, and retention runs manually (`pnpm prune:retention`). Scheduled publish (`publishAt`) does not fire on its own. | RESOLVED | No Redis/BullMQ/cron is introduced. The storefront's uncached content handlers cover publishes; only CDN-held sitemaps lag up to 10 minutes. |
| Q13 / Q19 | Media stays Cloudinary-oriented, with the CMS's local storage adapter standing in until a credential exists. No public media origin is chosen, so media stays out of the public projection and the logo id stays unresolved. | **WAITING_INPUT** (Cloudinary credentials) | Uploads and the library keep working locally; `PublicSite` keeps no media field, so nothing leaks a CMS-local path. |
| Q17 | No checkout in this round. The cart stays client-owned with server-side re-quoting; orders are not persisted anywhere. | RESOLVED (deferred) | WEB-06 stays Planned. The three checkout invariants (server-side reprice, duplicate rejection, out-of-stock refusal) stay in the queue as requirements for when a provider is chosen. |
| Q18 | No contact/newsletter form until a delivery target exists; no local-only stub that silently drops submissions. | RESOLVED (deferred) | WEB-07 stays Planned. The settings' contact address remains the only address in the system. |
| Q20 | Storefront URLs keep `no_prefix` locale selection by cookie. No `hreflang` is emitted, and canonical URLs stay per selected locale. | RESOLVED | `/san-pham` and `/products` remain distinct URLs; sitemap stays locale-free. Changing this later is a WEB-08 slice, not a refactor of the router. |

### D1–D5 (self-made decisions, accepted)

| ID | Decision | Status | Effect |
| --- | --- | --- | --- |
| D1 | Hub proxy: block `/api/v1/auth/**` entirely so tokens never reach the browser; business paths stay proxied until each domain migrates. | RESOLVED | Unchanged. |
| D2 | App binding: a session whose `appId` differs from the configured app is `403 APP_MISMATCH`; a missing `TM_TENANT_ID` is `503`, never a guessed tenant. | RESOLVED | Unchanged. |
| D3 | DB binding: the registry owns the database name; `TM_MONGO_DB` may only repeat it, otherwise `503 DATABASE_BINDING_MISMATCH`. | RESOLVED | Unchanged. |
| D4 | `GET /api/health` exposes only `status`, `hub`, `database` — no URI, tenant or credential. | RESOLVED | Unchanged. |
| D5 | Original wording: no `@tm/flow-server` package, no Hub writes, no data migration, no commit. | RESOLVED, with two notes | The package and Hub/migration parts still hold (see Q11, Q5). The "no commit" part is historical: the owner later authorised commits on `main`, and that authority is per-request — no commit or deploy happens without a current request. |

## 3. Reconciliation with the implementation

Checked against the code on 2026-11-09. Nothing needed changing, so no behaviour was modified for this record.

| Decision | Where it lives | Result |
| --- | --- | --- |
| Q7 | `tm-cms/server/utils/authSession.ts` (`MAX_AGE = 7 days`, `TOTP_MAX_AGE = 5 min`) | Matches. |
| Q8 | `authSession.ts` cookie options + the origin guard in the API middleware | Matches. |
| Q9 | `tm-cms/server/utils/context.ts` (`authMode === 'mock' && nodeEnv !== 'production'`, `503 AUTH_MODE_FORBIDDEN`) | Matches. |
| Q16 | `tm-cms/server/services/retentionService.ts` (`keepRevisions ?? 50`, `auditDays ?? 365`, dry-run default) | Matches. |
| Q3 / Q2 | customer registry + `server/utils/database.ts` | Matches: no invented names, legacy names kept. |
| Q12 | `tm-cms/server/utils/storefrontRevalidate.ts`, `tm-web/server/api/_internal/purge.post.ts` | Matches: header-reported outcome, best-effort, no queue. |
| Q20 | `i18n` strategy `no_prefix` in `tm-web` | Matches: no `hreflang` in the SEO composable. |
| Q13 | local media adapter + `PublicSite` projection without media | Matches: no public media field. |

## 4. WAITING_INPUT facts with no workaround

These block specific slices. Work continues on everything else; no placeholder credentials, databases or fixtures are used.

| Fact | Blocks | What is allowed meanwhile |
| --- | --- | --- |
| Production `TM_MONGO_URI` | Any production data work, P10 | Local MongoDB, disposable test databases |
| Cloudinary credentials (or a different public media origin) | Media in the public projection, logo URL, OG images | Local storage adapter, media library, attachments |
| Vercel token + customer domains | Deployment, CI, per-customer environments | Local builds, dev servers |
| Legacy data snapshot | Migration dry-run, enabling the three remaining customers with real data | New records only |

## 5. Consequences

- The queue is now limited by effort, not by unanswered questions: P4–P10 slices still require real provider accounts, but P2/P3 parity work can continue.
- Four behaviours that a reader might expect to be "solved" stay deliberately absent (checkout, forms, public media, locale-prefixed URLs). Each is a scoped slice with its own test plan, not a hidden gap.
- Revocation is the one security caveat that stays: rotation happens on re-login, not instantly. Any future claim of "Verified" for P1 must repeat it.
- Because no media origin exists, the storefront must never render a CMS-local path; the `PublicSite` schema without a media field is what enforces that.

## References

- [`tasks/questions.md`](../../tasks/questions.md) — question text, defaults and the status table.
- [`tasks/todo.md`](../../tasks/todo.md) — slice queue and phase status.
- [ADR 0001](0001-rebuild-ownership.md) — ownership and layer boundary.
- [`docs/v2/05-feature-parity.md`](../v2/05-feature-parity.md) — which parity rows each decision affects.
