# Media Cross-Host Adapter Contract (Draft)

Status: design only. Implementation waits for provider/public origin decision (see `docs/OWNER-DECISIONS.md`).

## Goal

Allow `tm-websites` (web) to reference and deliver media stored by `tm-hub` (CMS) without production cutover.

## Constraints

- Legacy DB remains read-only.
- No production upload/mutation in this phase.
- Public origin and provider credentials are owner-controlled.

## Proposed contract

- `tm-hub` exposes a read-only media metadata endpoint returning: `id`, `legacyId`, `mimeType`, `size`, `publicUrl`, `variants[]`, `checksum`.
- `tm-websites` consumes metadata and renders via `publicUrl`; never stores binary.
- Cross-host requests require service token (rotate before revoke; see J4).
- Cache headers: `Cache-Control: public, max-age=31536000, immutable` for content-addressed variants.
- Fallback: if `publicUrl` missing, render placeholder and log `legacy.mediaSkipped`.

## Open questions

1. Provider/public origin (owner).
2. Variant generation responsibility (hub vs CDN).
3. Auth scope for private media.
