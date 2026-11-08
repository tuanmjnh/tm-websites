# CMS agent guidance

Read the [monorepo rules](../AGENTS.md), [canonical docs](../docs/v2/README.md), [IAM contract](../docs/v2/03-hub-auth.md) and [feature parity](../docs/v2/05-feature-parity.md) first.

- This host is Nuxt 4 SPA (`ssr: false`) with Nitro BFF, not a frontend-only application.
- Keep pages/layouts in `tm-shared/nuxt-layers/cms-base` or explicit domain/customer layers, not this host's `app/pages` or `app/layouts`.
- The registry resolver selects customer-first layers. Do not use obsolete `tm-shared/packages/nuxt-layer-*` paths or add a second extends chain.
- Identity/users/roles/grants use Hub through narrow server-side SDK adapters. Business content/config/media/mail/notifications and ERP use local MongoDB services; existing Hub business pages are transitional.
- Never derive private tenant access solely from runtimeConfig or trust menu/capability filtering as server authorization.
- Use CmsBasePage, existing design tokens, Nuxt UI 4, Zod forms, soft buttons and vi/en translations. Nested settings content must not duplicate the outer page/panel.
- Every data flow needs loading/empty/error/forbidden states and mutation reentrancy protection. Never replace missing services with fake successful data.
- Use the root alias boundaries: no app/server cross-imports, `#server` for host internals, explicit package exports across layers.
- Verify applicable root gates and actual browser flows; keep secrets/tokens out of UI state. No production writes or unrelated repository changes.
