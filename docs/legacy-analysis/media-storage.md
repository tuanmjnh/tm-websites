# Legacy Media Storage — Reverse Engineering

Source: `nuxt4-cms/server/models/Media.ts` (read-only). Target already has a richer media model in `tm-cms/server/models/media.ts`; this note captures the legacy shape so migration and parity work can map fields without guessing.

## Collection: `medias`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `filename` | string | required, display name |
| `path` | string | required, storage key / URL path |
| `mimetype` | string | required |
| `size` | number | bytes |
| `type` | enum | `image`, `video`, `document`, `other` (default `other`) |
| `ownerId` | ObjectId → `users` | required |
| `metadata` | object | `{ width?, height?, duration? }` |
| `isPublic` | boolean | default false |
| `isDeleted` | boolean | default false |
| `history` | ChangeData[] | audit trail (see `Schemas.ts`) |
| `createdAt`, `updatedAt` | number (ms) | custom timestamp currentTime |
| `deletedAt` | number (ms) | null default |

## Indexes

- `{ filename: 'text', type: 1 }` — text search on filename plus type filter.

## Invariants / observations

- Media bytes are not stored in Mongo; only metadata + storage path.
- Ownership is user-based (`ownerId`), not site-based; target media is site-scoped (`siteId`). Migration must assign a site and drop/keep owner according to IAM.
- No folder tree in legacy; target added folders.
- `isPublic` controls delivery; target media route is public by URL key and site check.
- Soft delete via `isDeleted`/`deletedAt`; target uses same pattern plus revision.
- History/audit stored embedded in the document in legacy; target uses separate `audit_logs` collection.

## Migration notes

- Map `ownerId` → site/actor; legacy has no site concept.
- Convert ms timestamps to Date if target expects Date (target uses Date via Mongoose timestamps).
- `metadata` maps directly; target stores dimensions in metadata too.
- `isPublic` can map to target visibility rules (target media route is always public by key; access control is at CMS API).
- No provider/origin decision yet (Q19); legacy stores `path` only, so provider adapter must preserve path compatibility or rewrite URLs.

## Open questions (owner)

- Q19: provider (Cloudinary/R2/S3), public origin, transforms, signed upload.
- Whether to preserve legacy `path` values or migrate to new storage keys.
