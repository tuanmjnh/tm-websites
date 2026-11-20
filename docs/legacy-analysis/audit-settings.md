# Legacy Audit, Settings and Roles — Reverse Engineering

Source: `nuxt4-cms/server/models/{Company,SystemConfig,Role,History,Notification,NotificationTask,...}.ts` (read-only). Target already has `settings`, `site_menus`, `audit_logs`, `content`, `media` collections; this note maps the remaining legacy operational collections.

## `companies`

Single company profile document (legacy has no multi-site company collection in target terms; target settings are per site).

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `shortName`, `slogan`, `badge`, `desc` | LocalizedString | |
| `address` | array | `{ address: LocalizedString, isDefault, sort }` |
| `phone`, `fax`, `email`, `website`, `hotline`, `taxCode` | string | |
| `logo`, `favicon`, `banner` | Mixed | media refs/objects |
| `gallery` | array | `{ url, title, subtitle, badge, link, sort }` |
| `mapEmbed` | string | |
| `social` | SocialLink[] | |
| `openingHours` | LocalizedString | |
| `bankAccounts` | BankAccount[] | |
| `seo` | SeoData | |
| `history` | ChangeData[] | embedded audit |
| `createdAt`, `updatedAt` | number (ms) | |

## `system_configs`

Key/value configuration store with UI metadata.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | required, unique, indexed |
| `value` | Mixed | required |
| `type` | enum | `string`, `number`, `boolean`, `json`, `image` |
| `inputType` | enum | `text`, `password`, `textarea`, `number`, `switch`, `json`, `image` |
| `isPublic` | boolean | default false |
| `description` | string | |
| `group`, `subGroup` | string | |
| `options` | Object[] | |
| `sort` | number | |
| `history` | ChangeData[] | |
| `createdAt`, `updatedAt` | number (ms) | |

## `roles`

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | required, unique, uppercase, trimmed, indexed |
| `title` | string | required, trimmed |
| `description` | string | |
| `color` | string | default `#3b82f6` |
| `icon` | string | default `i-lucide-shield` |
| `allowedRoutes` | ObjectId[] → `system_routes` | |
| `types` | string[] | indexed |
| `isDefault` | boolean | |
| `sort` | number | |
| `history` | ChangeData[] | |
| `isDeleted`, `deletedAt` | boolean / number (ms) | |
| `createdAt`, `updatedAt` | number (ms) | |

## Audit pattern

- Legacy embeds `history: ChangeData[]` in every document; target uses a separate `audit_logs` collection with `resourceType`, actor, revision, changed fields, request id.
- Target already has audit read surface and retention; no further legacy audit migration needed beyond field mapping.

## Migration notes

- `companies` → target `settings` (site-scoped): map company profile fields; media refs need provider decision (Q19).
- `system_configs` → target `settings` or a separate config store; target currently has per-site settings only. Decide whether to migrate global configs.
- `roles` are Hub/IAM concerns in target (Hub owns auth/permissions); do not migrate roles into CMS DB.
- Timestamps: ms → Date.

## Open questions (owner)

- Whether to migrate `system_configs` into target settings or keep as separate config.
- Media provider/origin (Q19) affects logo/favicon/banner/gallery migration.
