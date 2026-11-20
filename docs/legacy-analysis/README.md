# Legacy Analysis — Index

Reverse-engineering notes derived read-only from `nuxt4-cms`/`nuxt4-website`. No raw PII or secrets are committed.

## Documents

| File | Domain |
| --- | --- |
| `crm.md` | CRM: customers, customer segments, users (identity) |
| `commerce.md` | Commerce: quotations, purchase orders, suppliers |
| `inventory.md` | Inventory/warehouse/serial |
| `hr-communications.md` | HR, notifications, integrations |
| `media-storage.md` | Media storage and public delivery |
| `audit-settings.md` | Company, system config, roles, audit pattern |

## Sanitized fixtures

| File | Source | Counts |
| --- | --- | --- |
| `fixtures/crm-sanitized.json` | `sen-tuan` (redacted, synthetic PII) | 3 customers, 2 segments, 3 identities |
| `fixtures/commerce-sanitized.json` | `sen-tuan` (redacted, synthetic PII) | 3 quotations, 6 POs, 3 suppliers, 3 warehouses, 49 inventories |

## Status

- Reverse-engineering (P5–P8) landed for CRM, commerce, inventory, HR/communications, media, audit/settings.
- CRM is implemented on the new collections (`crm_customers`/`crm_customer_segments`) with CMS screens; see the CRM-01 slice record in `docs/v2/05-feature-parity.md`. The legacy `customers`/`customer_segments` documents are still unimported and remain read-only.
- Commerce, inventory, finance and HR still wait for the owner decisions in `docs/OWNER-DECISIONS.md` before their slices start.
- No production data was written, seeded, archived or hard-deleted.
