# TM Websites

Rebuild of the full `nuxt4-cms` administration/ERP suite and `nuxt4-website` public website using Nuxt 4 layers, Nuxt UI 4 and MongoDB. `tm-hub` owns identity and authorization; `tm-hub-client` is the intended server-side IAM SDK. All other business domains belong to this monorepo.

**This is an implementation in progress, not a completed migration.** The existing code mixes Hub-backed business pages with a MongoDB storefront. The documentation reset dated 2026-11-06 defines the migration away from that mixed ownership.

## Start here

- [Canonical documentation index](docs/v2/README.md): architecture, baseline, full feature parity, implementation phases and acceptance criteria.
- [AI instructions](AGENTS.md): read before editing.
- [Current work queue](tasks/todo.md): next phase and blockers.
- [Historical archive](docs/archive/v1/INDEX.md): superseded plans and old verification claims; not current instructions.

## Workspace

| Directory | Responsibility |
| --- | --- |
| `tm-cms/` | Independently deployed Nuxt SPA and administrative Nitro BFF |
| `tm-web/` | Independently deployed SSR website and public Nitro API |
| `tm-shared/nuxt-layers/` | Shared foundation and CMS/Web application layers |
| `tm-shared/customer-layers/` | Registry-selected customer branding, layout and composition |
| `tm-shared/packages/` | Contracts, configuration, pure utilities and design tokens |

Two deployable applications do not require two repositories. Local workspace packages remain the default; publishing a package is not a prerequisite.

## Local start

Use the Node and pnpm versions declared in [package.json](package.json). Configure only local/test services using the [operations guide](docs/v2/08-operations-and-verification.md); do not copy credentials from legacy projects.

```sh
pnpm install --frozen-lockfile
TM_CUSTOMER_ID=sentuan TM_AUTH_MODE=hub pnpm dev:cms
TM_CUSTOMER_ID=sentuan pnpm dev:web
```

Run the two development commands in separate terminals. CMS uses port 4005; Web uses port 4006. The commands use Git Bash/POSIX environment syntax. Installation runs package lifecycle scripts; use only in a trusted development checkout. Missing Hub or MongoDB configuration is not a reason to enable mock production data.

## Checks

```sh
pnpm validate:registry
pnpm verify:scaffold
pnpm test:layers
pnpm test:hub
pnpm test:web-content
pnpm --dir tm-shared run typecheck
pnpm typecheck
pnpm lint
```

Run lint after the final Nuxt prepare/typecheck step. These checks do not prove feature parity, browser behavior, tenant isolation or production readiness. Follow the [complete verification matrix](docs/v2/08-operations-and-verification.md) for builds and functional acceptance. No application gates were rerun by the documentation-only reset.
