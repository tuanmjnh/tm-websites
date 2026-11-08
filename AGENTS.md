# AGENTS.md — TM Websites

## Read first

[Canonical docs](docs/v2/README.md) -> [current baseline](docs/v2/01-current-state.md) -> [architecture](docs/v2/02-architecture.md) -> [IAM](docs/v2/03-hub-auth.md) -> [Mongo/API](docs/v2/04-data-and-api.md) -> relevant [parity rows](docs/v2/05-feature-parity.md) -> [module layout](docs/v2/11-target-module-layout.md) -> [current queue](tasks/todo.md). Follow [the AI execution contract](docs/v2/09-ai-execution.md).

The full legacy `nuxt4-cms` and `nuxt4-website` capabilities are the target, not only a storefront MVP. Legacy repositories are read-only references. [Archived v1 docs](docs/archive/v1/INDEX.md) are history, not implementation instructions or current PASS evidence.

## Ownership

- `tm-cms`: Nuxt 4 SPA + administrative Nitro BFF. `tm-web`: Nuxt 4 SSR + public/portal Nitro APIs. One monorepo, independently deployable hosts.
- Nuxt UI 4, Tailwind CSS 4, Vue 3, pnpm only. Follow package.json/lockfile versions.
- TM Hub owns identities, credentials, sessions, app membership, roles and permission grants. The actual SDK package is `tm-hub-client`; use it server-side. No packaged Nuxt auth module is currently available.
- ALL business domains belong to tm-websites/MongoDB: content, configuration, media metadata, catalog, commerce, CRM, purchasing, inventory, finance, HR, communications and business audit. Do not introduce new Hub business dependencies.
- Existing Hub-backed business pages are transitional. Migrate consumers and data with tests; do not delete existing records or working flows blindly.
- Never port local auth authority, credential defaults or development permission bypasses from legacy code.

## Layers and aliases

- Canonical registry: `tm-shared/customer-layers/registry/customers.ts`. Resolver controls composition; do not hardcode customer identity in hosts/base layers.
- Priority: host > selected customer > cms/web-base > api-base > config-base > core-base. Earlier extends wins among layers. Avoid duplicate module/base registration.
- Host apps must not contain `app/pages` or `app/layouts`; shared UI lives in app/domain layers, overrides in customer layers.
- Customer branding/content assets stay in their customer layer. Shared packages retain actual `@tm/flow-*` names unless a scoped rename is approved.
- `~/` and `@/` address app source; never import `~/server`. `~~/` and `@@/` are root references, never `~~/app` or frontend-to-server shortcuts.
- Frontend must never import server modules; server must never import app modules. Shared DTOs/validators belong in `shared/` or explicit shared package exports, not root `types/`.
- Use `#server/` for host server internals and `#shared/` for resolved app/server-safe shared files. Verify local-layer alias resolution; these aliases are not arbitrary sibling-layer selectors.
- Resolve layer-local configuration/assets from `import.meta.url`; use explicit workspace exports across packages.

## Data and security

- One MongoDB database per customer, selected by trusted server deployment binding; paired CMS/Web share business storage with distinct policies and credentials.
- Registry IDs, browser input, menu visibility and SDK capability helpers are not authorization. Every private operation requires verified app/user context, capability and resource ownership.
- Current Hub introspection does not prove live revocation or tenant/site membership. Do not claim otherwise or distribute the Hub signing secret. See IAM prerequisites.
- Access/refresh/TOTP tokens must remain HttpOnly and server-only. Narrow BFF routes, safe DTOs and CSRF protection are target invariants; the current generic proxy is not assumed safe by default.
- Share server-side domain invariants/models, not admin endpoints/public query policy. Public DTOs use allowlists; checkout reprices server-side.
- Never log/expose secrets, copy `.env` values, or run destructive seed/reset/migration operations without explicit authorization.

## UI and verification

- Use Nuxt UI 4 components and valid theme slots. Standard primary buttons use soft; cancel/close use ghost. Forms use UForm + Zod + matching UFormField names, full-width inputs and vi/en text.
- Preserve loading/empty/error/forbidden states; disconnected data is not fake demo success.
- Run all applicable [verification gates](docs/v2/08-operations-and-verification.md), including registry/scaffold/layers/contracts, shared/host typecheck, lint, selected-customer validation and actual builds.
- Run lint after final Nuxt prepare/typecheck/build regeneration. Inspect output and exit codes; no truncated gate pipelines.
- UI changes require browser golden-path and edge-case checks; PWA needs fresh install/offline/update checks. If a check cannot run, report NOT RUN/BLOCKED, not PASS.
- After each slice update the current queue and parity evidence. Do not reuse archived test counts or PASS claims for current code.
- Preserve existing work; no commit, push, deployment, shared-state mutation or sibling-repository modification without explicit authorization.
