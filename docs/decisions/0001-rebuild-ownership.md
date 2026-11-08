# ADR 0001 — Rebuild ownership and Nuxt layer boundary

## Status

Accepted for the user-selected architectural direction on 2026-11-06. Detailed API/schema designs and external-system changes still require implementation review. This record does not claim the migration is implemented.

## Context

The new monorepo has reusable Nuxt layers, Hub-backed administration pages and a partial MongoDB catalog. Earlier documents alternated between independent package repositories and a monorepo, and between Hub-hosted business services and customer MongoDB. The user requested a complete reconstruction of the two legacy applications with an explicit split between central authentication and local business data.

## Decision

- Keep one `tm-websites` pnpm monorepo with independently deployable Nuxt 4 CMS SPA and Web SSR hosts.
- Use Nuxt UI 4 and customer-selected layers; keep generic base layers free of customer identity.
- Use TM Hub for identities, credentials, sessions, app membership, roles and permission grants. Integrate through the actual `tm-hub-client` package on the server, not an invented Nuxt module.
- Keep content, catalog, commerce, CRM, inventory, purchasing, finance, HR, business configuration, media metadata, communications, business audit and any optional AI business features in tm-websites services and MongoDB.
- Use a logical MongoDB database per customer; paired CMS/Web share domain storage but have different API DTOs, authorization and read/write privileges.
- Treat legacy projects as read-only references. Preserve their capabilities and data semantics, not obsolete auth code, embedded credentials or framework structure.

## Alternatives considered

### Continue Hub as the general backend

Reuses existing pages, but contradicts the requested ownership and makes completion of ERP depend on unrelated Hub features. Rejected for business domains; IAM management remains in Hub.

### Copy both legacy applications independently

Faster initial scaffolding, but duplicates models, rules and local authentication. Rejected. Reuse validated behavior through shared domain contracts/invariants and explicit host adapters.

### Publish every shared package first

Useful for independent consumers later, but adds release coordination without solving current parity. Deferred. Local workspace packages are sufficient now.

## Consequences

Existing Hub-backed business code requires migration, not mere relabeling. Authentication must not be reimplemented locally. Missing authoritative Hub session/app/tenant entitlement semantics block production private operations until resolved; the websites project must not silently forge those semantics.

Shared storage does not authorize shared endpoint policy: public projections must never expose administrative or financial fields. Per-customer isolation, data migration, SEO URL compatibility and rollback require explicit tests.

## References

- [Canonical index](../v2/README.md)
- [Architecture](../v2/02-architecture.md)
- [IAM contract](../v2/03-hub-auth.md)
- [Historical archive](../archive/v1/INDEX.md)
