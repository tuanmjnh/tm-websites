# 02 — Target architecture

Status: target specification, with existing paths identified explicitly. Decision: [ADR 0001](../decisions/0001-rebuild-ownership.md).

## Ownership and request flow

```text
CMS browser -> same-origin CMS Nitro BFF -> Hub SDK -> TM Hub IAM
                                      -> verified context -> business services -> customer MongoDB
Web browser -> Web SSR / public API    -> public read policy -> customer MongoDB
            -> narrow public commands -> business services -> customer MongoDB
Signed-in portal -> Web auth BFF       -> Hub SDK -> TM Hub IAM
                                      -> verified owner context -> business services
```

The portal auth BFF is target work; the current auth handlers live only in CMS. Never claim a shared composable alone makes Web authentication available.

| Owner | Data and behavior |
| --- | --- |
| TM Hub | Global identities, passwords, MFA/passkeys, token/session issuance, app membership, role/permission grants and IAM audit |
| tm-hub-client | Typed transport for supported Hub IAM operations; not a session authority or Nuxt auth module |
| tm-websites | All business schemas, services, validations, content, catalog, orders, stock, purchasing, finance, HR, CRM, portals, communications, business settings and audit |
| MongoDB | Customer business records, migration/version records, business events and durable jobs where needed |
| Provider adapters | Object storage/media, delivery, email, push, payment and optional AI integrations owned by tm-websites; secret material remains server-only |

Business media metadata belongs in MongoDB; binaries need not be stored as BSON documents. Retain existing provider compatibility through adapters, with storage and delivery infrastructure chosen per deployment. Hub's own use of Supabase is outside the websites persistence boundary.

## Existing layout and intended evolution

| Location | Responsibility and restriction |
| --- | --- |
| `tm-cms/`, `tm-web/` | Host configuration, modules, runtime/deployment composition and host-specific Nitro endpoints. No host `app/pages` or `app/layouts`. |
| `tm-shared/nuxt-layers/core-base/` | Nuxt UI integration, common low-level application foundation |
| `tm-shared/nuxt-layers/config-base/` | Validated build/customer configuration, not a business configuration database |
| `tm-shared/nuxt-layers/api-base/` | Shared API client mechanics and auth-facing contracts/composables; never browser token storage |
| `tm-shared/nuxt-layers/cms-base/` | CMS shell, login UI and current common admin pages |
| `tm-shared/nuxt-layers/web-base/` | Minimal SSR shell and current starter pages; future separation must preserve custom website overrides |
| `tm-shared/customer-layers/{cms,web}/` | Customer branding, assets, theme and page/layout composition; no copied generic business services |
| `tm-shared/customer-layers/registry/` | Customer/app/build selection source of truth |
| `tm-shared/packages/flow-contracts/` | Zod schemas and public/admin contracts; no server imports |
| `tm-shared/packages/flow-config/` | Configuration types and pure validation |
| `tm-shared/packages/flow-utils/` | Reusable pure helpers; server-only or browser-only exports must stay separated |
| `tm-shared/packages/design-system/` | Shared CSS tokens and design primitives |

Introduce a server-only domain package under `tm-shared/packages/` during Phase 2, after selecting and testing its export map. Its final name is not yet an existing import. It owns Mongoose schema factories, shared business commands and invariants. Host adapters own authorization, public/admin projections and endpoint contracts. Do not import CMS endpoint implementations into Web.

Domain modules initially belong in explicit domain folders. Add optional Nuxt module layers only when customer composition requires them; do not create dozens of empty layers or rely on automatic discovery to install optional modules. A future module manifest must define dependencies, routes, permissions and customer enablement. Enablement controls product composition, not authorization.

## Layer priority

The [current resolver](../../tm-shared/customer-layers/registry/resolver.ts) returns explicit `extends` in this order:

```text
Host overrides
  > selected customer layer
  > cms-base OR web-base
  > api-base
  > config-base
  > core-base
```

Earlier `extends` entries have higher priority; the host has the highest priority overall. This is a conflict/override rule, not a claim that every configuration array is replaced. Verify module registration, page names, components, CSS and server route collisions in the generated app. Do not repeat base layers inside customer `extends` or register a module twice.

When optional domain/starter layers are introduced, change the resolver and priority tests together; customer overrides must remain highest among extended layers. Test a minimal custom Web customer that does not require catalog UI. Do not replace the current resolver spec with obsolete paths under `packages/nuxt-layer-*`.

## Nuxt 4 aliases and boundaries

| Alias | Intended use |
| --- | --- |
| `~/`, `@/` | Application source under `app/`; never `~/server` |
| `~~/`, `@@/` | Project/layer root, only for files outside `app/` and `server/` |
| `#shared/` | App/server-safe types and utilities in `shared/` |
| `#server/` | Nitro server internals; never import from frontend |
| `#imports`, `#app`, `#build` | Generated Nuxt interfaces |

Nuxt's local layer alias resolution can scope `~`, `~~`, `@`, `@@` to the layer. Do not assume an alias points to the consuming host or that `#shared`/`#server` automatically identifies an arbitrary sibling layer. Inspect generated aliases and test both hosts. Use explicit workspace package exports for shared contracts and `import.meta.url`-based resolution for layer-local config/module assets. Named layer aliases may be used only when actually generated/configured and typechecked.

- Frontend must never import MongoDB, server SDK adapters, secrets or `server/` modules.
- Server must never import `app/`; promote genuinely shared DTOs to `shared/` or `@tm/flow-contracts`.
- Use `#server` for host server imports instead of deep traversal; use explicit package exports for cross-package server code.
- Avoid a root-level `types/` directory. App-only, server-only and shared types must have distinct homes.

## Customer, application and site isolation

`customerId` selects build composition. `tenantId` represents customer ownership. `appId` is the Hub installation used for authorization. `siteId` is a publication/channel dimension inside that customer's business data. They are not interchangeable.

Default deployment model: one customer per host build, one logical MongoDB database per customer, independently deployed CMS and Web. Paired hosts use the same business database with different privileges. CMS-only customers are valid. Multi-site data must be explicitly filtered by site where the domain requires it; a single default site in current config is not evidence that multi-site entitlement exists.

The browser cannot select an arbitrary database, URI or tenant. Trusted server deployment binding must match the verified app context. Runtime multi-customer multiplexing is not part of the current deployment model and must not be introduced by switching a global Mongoose connection per request.

## Official references checked during reset

- [Nuxt 4 layer priority](https://nuxt.com/docs/4.x/getting-started/layers)
- [Nuxt layers authoring](https://nuxt.com/docs/4.x/guide/going-further/layers)
- [Nuxt configuration](https://nuxt.com/docs/4.x/api/nuxt-config)

Context7's Nuxt v4.1.3 documentation confirmed priority and local alias behavior; the target package declares a newer 4.x version. Generated configuration in the installed version remains the final compatibility check.
