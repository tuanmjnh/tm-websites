# Legacy analysis — CRM (customers, segments, loyalty/metrics)

Status: reverse-engineered from `nuxt4-cms` source and read-only local MongoDB (`sen-tuan`, `bag-post`).  
No raw customer records, emails, phones, addresses or segment titles are reproduced here; only schema, workflow, aggregate counts and redacted field coverage.

## 1. Scope and evidence

Legacy source:

- `nuxt4-cms/server/models/Customer.ts`
- `nuxt4-cms/server/models/CustomerSegment.ts`
- `nuxt4-cms/server/services/customer.service.ts`
- `nuxt4-cms/server/api/v1/admin/commerce/customers/*`
- `nuxt4-cms/server/api/v1/admin/commerce/segments/*`
- `nuxt4-cms/shared/schemas/customer.ts`
- `nuxt4-cms/shared/schemas/customerSegment.ts`
- `nuxt4-cms/docs/modules/COMMERCE_MODULE.md` §1–2
- `nuxt4-cms/docs/ARCHITECTURE.md` (customer/segment summaries)

Local DB evidence:

- `sen-tuan`: `customers` 3, `customer_segments` 2, `users` 16 total (`customer` 3, `staff` 6, `system` 3, `supplier` 3, `hr` 1)
- `bag-post`: `customers` 0, `customer_segments` 0
- Source DB access was read-only; no writes, no raw document dumps.

Target state:

- `tm-websites` has no CRM domain implementation yet (`CRM-01` is `Planned` in `docs/v2/05-feature-parity.md`).
- Hub owns identity: `User`/role/permission/session authority is not duplicated in target. Legacy `Customer` is a business profile linked to a Hub subject, not a login authority.

## 2. Legacy behavior

### 2.1 Customer entity

- A `Customer` is always linked to one login `User` (`userId`, required, unique) with `type: 'customer'`.
- `code` is generated uppercase (`CUS…`) and unique.
- `addresses[]` are stored on the customer document (legacy `AddressSchema` has `fullName`, `phone`, `street`, `ward`, `city`, `country`, `isDefault`, `sort`; target `tm-websites` AddressSchema omits `district` in current target schema).
- `customerSegment` is an optional ObjectId reference to `customer_segments`.
- `loyaltyPoints` is a stored number.
- `metrics` stores `totalOrders`, `totalSpent`, `lastOrderAt` (observed locally: `lastOrderAt` absent in all 3 sample customers).
- `note`, `isActive`, `isDeleted`, `deletedAt`, `history[]`.
- Profile fields (`fullName`, `phone`, `gender`, `birthday`, `avatar`, `bio`, `address`, `city`, `country`, `social`, `bankAccounts`) are stored on the linked `User.profile`, not duplicated on `Customer`.

### 2.2 Customer CRUD / service

- `createCustomer`:
  1. rejects duplicate email;
  2. resolves role `CUSTOMER`, fallback `isDefault: true`;
  3. creates linked `User` (`type: 'customer'`, username derived from email prefix and uniquified, temp password `Cus@…` or supplied password);
  4. generates `code`, creates `Customer`;
  5. writes history for both `User` and `Customer`.
- `updateCustomer` resolves by customer id or user id, updates profile on `User`, then selected customer fields (`customerSegment`, `loyaltyPoints`, `addresses`, `isActive`, `note`).
- `softDeleteCustomers` soft-deletes both `User` and `Customer` by id or userId, logs history.
- `deleteCustomers` hard-deletes both.
- List supports keyword search over linked user profile (`fullName`, `email`, `username`, `phone`), segment filter, cursor pagination by `createdAt`.
- Detail aggregates real-time order metrics (`totalOrders`, `totalSpent`) and recent orders; uses `Math.max` between stored metrics and computed aggregates.

### 2.3 Customer segments

- Fields: `title`, `code` (unique, uppercase), `description`, `defaultDiscountPercent`, `freeShipping`, `thumbnail`, `gallery[]`, `autoJoinCriteria { minSpent, minOrders }`, `sort`, `isDeleted`, `history[]`, timestamps.
- CRUD + bulk soft delete/restore + permanent delete + sort reorder + history.
- `defaultDiscountPercent` and `freeShipping` are **stored attributes only**: `commerceService.createOrder()` never reads them and there is no coupon/discount-code system. Discounts enter an order only through numeric `discountAmount`.

## 3. Data dictionary (field coverage, `sen-tuan`, n=3 customers)

Top-level `customers`:

| Field | Presence | Type | Notes |
|---|---:|---|---|
| `_id` | 3/3 | objectId | |
| `userId` | 3/3 | objectId | unique; links to `users` |
| `code` | 3/3 | string | uppercase generated |
| `addresses` | 3/3 | array | |
| `customerSegment` | 3/3 | objectId | references `customer_segments` |
| `loyaltyPoints` | 3/3 | number | |
| `metrics.totalOrders` | 3/3 | number | |
| `metrics.totalSpent` | 3/3 | number | |
| `note` | 3/3 | string | |
| `isActive` | 3/3 | boolean | |
| `isDeleted` | 3/3 | boolean | |
| `deletedAt` | 3/3 | null (all non-deleted) | |
| `history` | 3/3 | array | |
| `createdAt` | 3/3 | date | |
| `updatedAt` | 3/3 | date | |
| `__v` | 3/3 | number | Mongoose version |

Observed absent in all sample customers: `metrics.lastOrderAt`.

Top-level `customer_segments` (`sen-tuan`, n=2): all fields present per schema; `thumbnail` null in both, `gallery` empty array in both, `deletedAt` null in both. Counts only; titles/codes not reproduced.

Linked `users` with `type='customer'` (n=3): profile fields mostly present; `profile.address` absent in some users (13/16 across all types), `profile.birthday` absent in some (13/16). No password/hash values were read or reproduced.

Reference integrity to verify in target: every `customer.customerSegment` must resolve to an existing segment; every `customer.userId` must resolve to a `users` document with `type='customer'`. (Not yet computed; can be added as a read-only audit script if needed.)

## 4. Workflow and state transitions

Customer lifecycle:

1. Create (admin) → linked user + customer record, both audited.
2. Update profile/segment/loyalty/addresses/active state.
3. Soft delete / restore (both user and customer).
4. Hard delete (both user and customer) — destructive; target must decide whether hard delete is allowed or replaced by anonymization.

Segment lifecycle:

1. Create segment.
2. Update fields.
3. Reorder (`sort`).
4. Soft delete / restore (bulk).
5. Hard delete (bulk, by ids).

No automatic segment assignment exists: `autoJoinCriteria` is stored but no observed code applies it automatically in the audited source. This is a defect/unfinished behavior, not a required parity behavior unless owner decides otherwise.

## 5. Calculations and invariants

- `Customer.userId` is unique: one login subject per customer.
- `Customer.code` is unique.
- `CustomerSegment.code` is unique.
- Metrics are eventually consistent: stored metrics can lag; detail endpoint recomputes from orders and uses `Math.max`.
- Segment discount fields are not applied anywhere; target must not imply segment-based pricing unless owner explicitly requests it.
- Hard delete of a customer removes the linked user; target should prefer soft delete + anonymization to preserve order history references.

## 6. Defects / unsafe legacy behavior that must not be ported

1. Customer creation generates a temporary password (`Cus@…`) and stores a password on the linked user. Target uses Hub identity; no local password authority.
2. `deleteCustomers` hard-deletes users/customers, which can break historical order references. Target should retain business records and anonymize PII instead.
3. `autoJoinCriteria` is not enforced; do not advertise automatic segment assignment.
4. Segment pricing fields (`defaultDiscountPercent`, `freeShipping`) are non-functional; do not port as if they affect totals.
5. `metrics.lastOrderAt` is declared but not reliably populated in observed data.
6. Customer list search runs a separate `User.find` then `$in`; target should use a single scoped query or projection.

## 7. Mapping to target

Hub ownership:

- Login subject, password/MFA, session, role/capability, app membership remain in `tm-hub`.
- `Customer` in target is a business profile keyed by Hub `subject`/user id, not a local user.

Target domain placement (proposed, subject to Q11):

- Mongo collection `customers` (site-scoped) with `siteId`, `subjectId` (Hub user id), `code`, `addresses`, `customerSegmentId`, `loyaltyPoints`, `metrics`, `note`, `isActive`, `isDeleted`, audit fields.
- Mongo collection `customer_segments` (site-scoped) with current fields minus non-functional pricing unless owner opts in.
- CMS admin APIs under `/api/v1/admin/commerce/customers` and `/segments`, guarded by capabilities and CSRF.
- Web portal reads only through BFF/server-side commands; no direct browser mutation.
- Public storefront should not expose customer PII; customer portal uses Hub identity + target customer profile linkage.

Site scoping:

- All records must be scoped by `siteId`/customer binding, consistent with content/catalog services.
- `subjectId` must come from verified session, never from request body or URL.

## 8. Automated test scenarios (to implement in target)

CRM service tests:

1. Create customer requires unique email/subject; duplicate subject rejected.
2. Create customer generates unique code and links to segment if provided.
3. Update customer merges profile fields without losing untouched fields.
4. Soft delete/restores both business profile and linkage visibility; hard delete policy decided by owner.
5. Segment CRUD uniqueness and sort order.
6. Segment filter and keyword search scoped to site.
7. Metrics recomputation uses `Math.max` or a defined reconciliation rule.
8. Address default handling and validation.
9. Site isolation: customer/segment from site A invisible to site B.
10. Capability checks: read/write permissions enforced server-side.

Sanitized fixtures:

- Use deterministic fixture IDs and redacted profile values (names/emails/phones/addresses replaced).
- Preserve field shape, types, nullability, enums, relation shape and edge cases (missing `lastOrderAt`, empty gallery, null thumbnail).
- Do not copy raw customer documents or PII into tests or snapshots.

## 9. Open questions (for OWNER-DECISIONS.md)

1. Should target retain `autoJoinCriteria` and implement automatic segment assignment, or remove it as non-functional legacy behavior? Recommendation: remove automatic assignment unless owner confirms a business rule; keep segment as manual classification.
2. Should segment pricing fields (`defaultDiscountPercent`, `freeShipping`) be retained? Legacy never applies them. Recommendation: defer; implement only if owner confirms a discount policy, and then enforce in order creation.
3. Hard delete vs anonymization for customers with orders. Recommendation: soft delete + anonymization; preserve order/customer references.
4. Should `metrics.lastOrderAt` be required and populated on every order completion? Recommendation: yes, update transactionally with order completion.
5. Address schema includes `district` in legacy but target schema currently omits it. Confirm whether district is needed for shipping. Recommendation: include `district` if shipping carriers require it.

## 10. Next step

Implement CRM domain in `tm-websites` only after owner confirms the above questions and Q11 architecture. Until then, this document plus sanitized fixtures and service-level tests can be prepared without production data.
