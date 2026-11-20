# Legacy analysis — Inventory, warehouses, serials, purchasing

Status: reverse-engineered from `nuxt4-cms` source and read-only local MongoDB (`sen-tuan`, `bag-post`).

## 1. Scope and evidence

Legacy source:

- `nuxt4-cms/server/models/Warehouse.ts`, `Inventory.ts`, `InventoryTransaction.ts`, `ItemSerial.ts`, `Supplier.ts`, `PurchaseOrder.ts`
- `nuxt4-cms/server/services/inventory.service.ts`, `commerce.service.ts`
- `nuxt4-cms/docs/modules/INVENTORY_MODULE.md`, `INBOUND_WORKFLOW.md`, `POS_GUIDE.md`

Local DB evidence:

- `sen-tuan`: `warehouses` 3, `inventories` 49, `inventory_transactions` 0, `item_serials` 0, `suppliers` 3, `purchase_orders` 6
- `bag-post`: all zero
- Inventory transactions and serials have no observed records; shape comes from source.

Target state: `INV-01`, `INV-02`, `PUR-01` are `Planned`.

## 2. Legacy behavior

### 2.1 Warehouses

- Fields: `title`, `code` (unique, uppercase), `address`, `phone`, `status` (active/inactive), `description`, `avatar`, `sort`, soft delete, history, timestamps.
- No manager field (commented out).

### 2.2 Inventory balances

- One document per `(itemId, variantId, warehouseId)` (unique compound).
- Fields: `quantityOnHand`, `quantityReserved`, `sku` (denormalized), `binLocation`, `lowStockThreshold`, history, timestamps.
- Indexes for SKU, item/warehouse, warehouse levels, low stock, variant.

### 2.3 Inventory transactions

- Ledger: `code` (unique), `inventoryId`, `itemId`, `variantId`, `warehouseId`, `type` (enum), `quantityChange`, `previousQuantity`, `newQuantity`, `unitCost`, `totalValue`, `imeiCodes[]`, `referenceId`, `referenceCode`, `referenceModel` (enum), `reason`, `performerId`, timestamps.
- Types and reference models defined in `shared/utils/constants.ts`.
- No DB triggers; synchronization handled explicitly by service with Mongo sessions.

### 2.4 Item serials (IMEI/SN)

- Fields: `code` (unique), `itemId`, `variantId`, `warehouseId`, `status` (available/sold/transferring/defective/returned), `importPoId`, `soldOrderId`, `soldToCustomerId`, `importedAt`, `soldAt`, `warrantyEndAt`.
- Model exists but legacy write path incomplete; some IMEI fields written to non-existent schema fields. Target must not port this defect.
- Text index on `code` for global search.

### 2.5 Purchasing

- Supplier: `code`, `title`, `email`, `phone`, `status`, `rating`, `itemsSupplied[]`, `avatar`, soft delete, history.
- Purchase order: `code`, `supplierId`, `warehouseId`, `items[]`, `status`, `paymentStatus`, `paymentMethod`, `totalAmount`, `orderedTotalAmount`, `paidAmount`, `expectedDeliveryDate`, `reconcileNote`, soft delete, history.
- Partial receipt/reconciliation; supplier price history.

### 2.6 Stock movements

- Order creation reserves stock (`reserveStock`).
- Order ship requires `warehouseId`.
- Cancel releases reservations.
- POS sale deducts immediately (`modifyStock` type `export`).
- Returns restock via `modifyStock` type `return_in` or discard (no restock).
- Inventory transfer uses reference ids without a proper model (defect).

## 3. Data dictionary (field coverage, `sen-tuan`)

### 3.1 Inventories (n=49)

| Field | Presence | Type |
|---|---:|---|
| `_id` | 49/49 | objectId |
| `itemId` | 49/49 | objectId |
| `variantId` | 49/49 | objectId/null |
| `warehouseId` | 49/49 | objectId |
| `sku` | 49/49 | string |
| `quantityOnHand` | 49/49 | number |
| `quantityReserved` | 49/49 | number |
| `lowStockThreshold` | 49/49 | number |
| `history` | 49/49 | array |
| `createdAt`, `updatedAt` | 49/49 | number |
| `__v` | 49/49 | number |

Observed: `binLocation` absent in all 49 (field in schema but not populated).

### 3.2 Warehouses (n=3)

All fields present per schema; `deletedAt` null or number; `avatar` string.

### 3.3 Purchase orders (n=6)

See commerce.md §3.2. `reconcileNote` present in 5/6.

### 3.4 Suppliers (n=3)

`code`, `title`, `email`, `phone`, `status`, `rating`, `itemsSupplied[]`, `sort`, `avatar` (null all), soft-delete, history, timestamps.

### 3.5 Inventory transactions / item serials

0 records in both DBs; no field coverage available.

## 4. Defects / unsafe legacy behavior not to port

1. POS bypasses reservation; reservation does not check available quantity in one path.
2. Inventory transfer uses random reference ids without a model.
3. `ItemSerial` model exists but write path incomplete; IMEI written to non-existent schema fields.
4. No stocktake model/endpoint; no serial writer.
5. `binLocation` declared but never populated.
6. No automatic low-stock alert pipeline observed.

## 5. Mapping to target

- Mongo collections (site-scoped): `warehouses`, `inventories`, `inventory_transactions`, `item_serials`, `suppliers`, `purchase_orders`.
- Unique constraint on `(itemId, variantId, warehouseId)` for inventory balances.
- All stock mutations must be atomic and audited.
- Serial tracking only if owner confirms scope (Q: IMEI/serial in first replacement?).

## 6. Automated test scenarios

1. Concurrent reservations cannot oversell.
2. Reservation release on cancel.
3. POS immediate deduction; no double-adjust.
4. Return restock/discard.
5. Receipt cannot exceed ordered quantity.
6. Transfer atomic or compensated with audit trail.
7. Site isolation and capability checks.
8. Serial lifecycle (if in scope).

## 7. Open questions

1. Are serials/IMEI in first replacement scope?
2. Are transfers/adjustments/stocktake in first replacement scope?
3. Should low-stock alerts be implemented now or deferred?
4. Which inventory reports are required in first replacement?
