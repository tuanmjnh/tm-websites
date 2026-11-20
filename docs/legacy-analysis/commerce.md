# Legacy analysis — Commerce, quotations, purchasing, inventory, finance

Status: reverse-engineered from `nuxt4-cms` source and read-only local MongoDB (`sen-tuan`, `bag-post`).  
No raw customer/supplier/order data is reproduced; only schema, workflow, aggregate counts and redacted field coverage.

## 1. Scope and evidence

Legacy source:

- `nuxt4-cms/server/models/Order.ts`, `Quotation.ts`, `Payment.ts`, `PaymentTransaction.ts`, `Supplier.ts`, `Warehouse.ts`, `Inventory.ts`, `InventoryTransaction.ts`, `ItemSerial.ts`, `Cart.ts`, `Shipment.ts`, `ShippingCarrier.ts`
- `nuxt4-cms/server/services/commerce.service.ts`, `payment.service.ts`, `customer.service.ts`
- `nuxt4-cms/server/api/v1/admin/commerce/*`, `customer/*`, `pos/*`, `finance/*`, `shipping/*`
- `nuxt4-cms/docs/modules/COMMERCE_MODULE.md`, `ORDER_WORKFLOW.md`, `POS_GUIDE.md`, `SHIPPING_MODULE.md`, `INVENTORY_MODULE.md`

Local DB evidence:

- `sen-tuan`: `orders` 0, `quotations` 3, `purchase_orders` 6, `suppliers` 3, `warehouses` 3, `inventories` 49, `inventory_transactions` 0, `item_serials` 0, `payments` 0, `payment_transactions` 1, `shipments` 0, `carts` 0
- `bag-post`: `orders` 0, `quotations` 0, `purchase_orders` 0, `suppliers` 0, `warehouses` 0, `inventories` 0
- Orders/payments/shipments have no observed records; their shape comes from source only.

Target state:

- `COM-01`, `COM-02`, `COM-03`, `PUR-01`, `INV-01`, `INV-02`, `FIN-01`, `FIN-02` are `Planned` in `docs/v2/05-feature-parity.md`.
- Target has no commerce domain implementation yet.

## 2. Legacy behavior

### 2.1 Order entity and lifecycle

- Fields: `code` (`ORD-YYMMDD-xxxxxx`, unique), optional `customerId`, `userId` operator, `items[]` snapshot (itemId, variantId, supplierId, itemName, sku, attributes, price, quantity, thumbnail, returnedQuantity), money (`itemsPrice`, `shippingFee`, `discountAmount`, `totalAmount`, `currency`, `paidAmount`), status (`orderStatus`, `paymentStatus`, `paymentMethod`, `channel`), `bankingDetails`, `shippingAddress`, `note`, `warehouseId`, `history[]`.
- Enums: orderStatus `pending|processing|shipped|completed|cancelled`; paymentStatus `unpaid|paid|partial|refunded`; paymentMethod `cash|banking|cod|card|other`; channel `admin|portal|pos`.
- Item price is frozen at creation from variant/item sale/base price.
- Lifecycle: `pending → processing → shipped → completed`, with cancel from pre-ship states releasing reservations.
- `updateOrderDiff` adjusts reservations for added/removed/changed quantities and recalculates totals; blocked once shipped/completed/cancelled.
- Returns validate `quantity ≤ sold − already returned`; `restock` modifies stock, `discard` does not; refund total computed from line prices.

### 2.2 Order entry points

1. Admin/staff: `POST /api/v1/admin/commerce/orders`, resolves warehouse, reserves stock per item, snapshots supplier from `Supplier.itemsSupplied`, computes totals, creates payment transaction if `payment.type !== 'debt'`.
2. Portal explicit items: `POST /api/v1/customer/checkout`, forces `channel: portal`, `payment.type: debt`.
3. Portal from cart: `POST /api/v1/customer/orders`, reads cart then deletes it.
4. Guest: `POST /api/v1/public/commerce/checkout`, requires Turnstile token, `customerId: null`, sends emails asynchronously.

### 2.3 POS

- `POST /api/v1/admin/commerce/pos/checkout`: deducts stock immediately (`modifyStock` type `export`), creates completed/paid order, creates `PaymentTransaction` (`source: pos`), notifies customer.
- No reservation step; stock is deducted immediately.
- POS search endpoint for product lookup.

### 2.4 Quotations

- State/expiry, conversion to order, immutable accepted amounts.
- Legacy endpoints: list/create/update/delete, convert to order.
- Observed data: 3 quotations in `sen-tuan`, all with `convertedOrderId: null`.

### 2.5 Shipments / carriers

- Shipping carriers and shipments with partial fulfillment, returns/refunds.
- Webhook endpoint for carrier callbacks.

### 2.6 Payments and finance ledger

- Two collections: `payments` (gateway intent, mock/uncalled) and `payment_transactions` (cash-flow ledger).
- Gateway reality: `PAYMENT_GATEWAY_METHODS` constant only; no SDK/credentials/redirect flows; gateway creation is mock and uncalled.
- Finance reports: revenue chart, top products, categories, PnL, inventory, inventory value, debt details, top debtors, partner transactions.
- Manual ledger entries: `GET|POST /api/v1/admin/finance/transactions`.

### 2.7 Suppliers and purchasing

- Supplier: `code`, `title`, `email`, `phone`, `status`, `rating`, `itemsSupplied[]`, `avatar`, soft delete.
- Purchase order: `code`, `supplierId`, `warehouseId`, `items[]`, `status`, `paymentStatus`, `paymentMethod`, `totalAmount`, `orderedTotalAmount`, `paidAmount`, `expectedDeliveryDate`, `reconcileNote`.
- Partial receipt/reconciliation, supplier price history.

### 2.8 Warehouses and inventory

- Warehouse: `code`, `title`, `address`, `phone`, `status`, `sort`, soft delete.
- Inventory: per `(itemId, variantId, warehouseId)`: `quantityOnHand`, `quantityReserved`, `lowStockThreshold`, `sku`, history.
- Inventory transactions: movement ledger (type, source, reference).
- Item serials: model exists but legacy write path incomplete; some IMEI fields written to non-existent schema fields.
- Stock reservation concurrency defect: POS can bypass reservation; inventory transfer uses dangling random reference ids.

## 3. Data dictionary (field coverage, `sen-tuan`)

### 3.1 Quotations (n=3)

| Field | Presence | Type |
|---|---:|---|
| `_id` | 3/3 | objectId |
| `code` | 3/3 | string |
| `customerId` | 3/3 | objectId |
| `userId` | 3/3 | objectId |
| `channel` | 3/3 | string |
| `status` | 3/3 | string |
| `items` | 3/3 | array |
| `itemsPrice` | 3/3 | number |
| `shippingFee` | 3/3 | number |
| `discountAmount` | 3/3 | number |
| `totalAmount` | 3/3 | number |
| `shippingAddress.*` | 3/3 | string |
| `adminNote`, `customerNote`, `internalNote` | 3/3 | string |
| `assignedStaffId` | 3/3 | objectId/null |
| `warehouseId` | 3/3 | objectId/null |
| `validUntil` | 3/3 | number/null |
| `convertedOrderId` | 3/3 | null (all) |
| `estimatedCost`, `estimatedProfit` | 3/3 | number |
| `version` | 3/3 | number |
| `isDeleted` | 3/3 | boolean |
| `deletedAt` | 3/3 | null |
| `history` | 3/3 | array |
| `createdAt`, `updatedAt` | 3/3 | date |

### 3.2 Purchase orders (n=6)

All 6 have `status`, `paymentStatus`, `paymentMethod`, `supplierId`, `warehouseId`, `items`, `totalAmount`, `orderedTotalAmount`, `paidAmount`, `expectedDeliveryDate`, `createdBy`. `reconcileNote` present in 5/6.

### 3.3 Suppliers (n=3)

`code`, `title`, `email`, `phone`, `status`, `rating`, `itemsSupplied[]`, `sort`, `avatar` (null in all), soft-delete fields, history, timestamps.

### 3.4 Warehouses (n=3)

`code`, `title`, `address`, `phone`, `status`, `sort`, `description`, `avatar`, soft-delete fields (deletedAt null or number), history, timestamps.

### 3.5 Inventories (n=49)

`itemId`, `variantId` (objectId or null), `warehouseId`, `sku`, `quantityOnHand`, `quantityReserved`, `lowStockThreshold`, timestamps, history. No `inventory_transactions` records observed (0).

## 4. Workflow and state transitions

Order lifecycle (see §2.1).  
POS sale bypasses reservation and deducts immediately.  
Quotation expiry/conversion not fully enforced in legacy; target must define expiry and exactly-once conversion.  
Purchase order receipt partial; stock and payables reconcile.  
Inventory transfer/adjustment/audit not fully implemented in legacy.

## 5. Calculations and invariants

- Server must load price/variant/stock from DB and recompute totals; browser price is display hint only.
- Stock reservation must be atomic and prevent oversell.
- POS sale deducts immediately; do not double-adjust.
- Return quantity must not exceed sold − already returned.
- Currency/rounding must be tested; legacy uses VND.
- Payment status derives from `paidAmount` vs `totalAmount`.

## 6. Defects / unsafe legacy behavior not to port

1. Catalog/order values from browser are trusted in some paths; target must reprice server-side.
2. `returnedQuantity` not declared in schema strict mode; repeated returns can exceed sold quantity.
3. POS can bypass reservation; reservation does not check available quantity in one path.
4. Inventory transfer uses random reference ids with no model.
5. `ItemSerial` model exists but write path incomplete; IMEI fields written to non-existent schema fields.
6. Quotation expiry/discount segment and some finance reversal/payment rules not fully enforced.
7. HR mostly read-only; no shift model, no attendance/payroll write endpoints, no salary→payroll calculation.
8. Gateway payment creation is mock and uncalled; do not claim payment gateway integration.
9. Legacy default config contains committed secrets/credentials; treat as compromised and rotate before launch.

## 7. Mapping to target

Proposed domain placement (subject to Q11 and owner decisions):

- Mongo collections (site-scoped): `orders`, `order_items` (embedded or separate), `quotations`, `suppliers`, `purchase_orders`, `warehouses`, `inventories`, `inventory_transactions`, `shipments`, `payment_transactions`, `payments` (if gateway later).
- CMS admin APIs under `/api/v1/admin/commerce/*`, `/finance/*`, `/shipping/*`, guarded by capabilities + CSRF.
- Web portal only through BFF/server-side commands with object-level ownership.
- Public checkout remains blocked until Q17 is resolved.

## 8. Automated test scenarios (to implement in target)

Order service:

1. Create order reprices from DB; rejects unavailable stock.
2. State machine transitions enforced; cancel releases reservations.
3. `updateOrderDiff` adjusts reservations and totals; blocked after ship.
4. Return validates quantity and restock/discard.
5. Site isolation and capability checks.

POS:

1. Deducts stock immediately; creates paid/completed order + ledger row.
2. No double-adjustment.

Quotation:

1. Expiry enforced; conversion exactly-once under retry.

Inventory:

1. Concurrent reservations cannot oversell.
2. Transfer atomic or compensated; audit trail.

Purchasing:

1. Receipt cannot exceed ordered quantity; stock/payables reconcile.

Finance:

1. Currency/rounding; immutable posting/reversal; idempotent payment.

## 9. Open questions (for OWNER-DECISIONS.md)

1. Is public checkout in first replacement scope? (Q17)
2. Which payment methods/providers are actually used? (cash/banking/COD only vs card/gateway)
3. Should quotation expiry and segment discounts be implemented or removed?
4. Should item serials/IMEI be in first replacement scope or deferred?
5. Should inventory transfers/adjustments be implemented or deferred?
6. Finance reporting scope for first replacement.
7. HR/attendance/payroll scope for first replacement (currently mostly read-only in legacy).

## 10. Next step

Implement commerce domain only after owner confirms scope via `docs/OWNER-DECISIONS.md`. Until then, service-level tests and sanitized fixtures can be prepared without production data.
