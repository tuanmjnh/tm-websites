import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { OrderDocument, OrderItem } from '../models/order'
import { InventoryServiceError } from './inventoryService'

/**
 * Stock effects of an order are derived from its state, never from a separate
 * flag: pending/processing hold a reservation, shipped/completed moved the
 * goods out, cancelled holds nothing. That keeps every transition idempotent
 * and makes a crash between the two writes recoverable by replaying the same
 * transition.
 */
export type OrderMovementKind = 'reserve' | 'release' | 'deduct' | 'sell' | 'restock' | 'unsell'

export interface OrderStockDeps {
  inventory: Model<InventoryDocument>
  transactions?: Model<InventoryTransactionDocument> | null
}

export interface OrderStockState {
  warehouseId: string | null
  status: string
  items: Pick<OrderItem, 'itemId' | 'variantId' | 'quantity'>[]
}

export interface OrderStockReference {
  id: string | null
  code: string
  model: 'Order' | 'OrderReturn'
}

export interface OrderStockMeta {
  actorId?: string
}

export interface StockLine {
  itemId: string
  variantId: string | null
  quantity: number
}

interface PlannedMovement {
  kind: OrderMovementKind
  line: StockLine
  warehouseId: string
  reference: OrderStockReference
}

const ACTIVE_STATUSES = new Set(['pending', 'processing'])
const TERMINAL_STATUSES = new Set(['shipped', 'completed'])
const OBJECT_ID = /^[a-f0-9]{24}$/

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status)
}

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

function lineKey(warehouseId: string, line: StockLine): string {
  return `${warehouseId}|${line.itemId}|${line.variantId ?? ''}`
}

function quantityByLine(warehouseId: string, items: OrderStockState['items']): Map<string, StockLine> {
  const map = new Map<string, StockLine>()
  for (const item of items ?? []) {
    const itemId = typeof item.itemId === 'string' ? item.itemId.trim() : ''
    if (!OBJECT_ID.test(itemId)) continue
    const variantId = typeof item.variantId === 'string' && item.variantId.trim() ? item.variantId.trim() : null
    const line = { itemId, variantId, quantity: Math.max(0, Math.trunc(Number(item.quantity) || 0)) }
    if (line.quantity < 1) continue
    const key = lineKey(warehouseId, line)
    const existing = map.get(key)
    if (existing) existing.quantity += line.quantity
    else map.set(key, line)
  }
  return map
}

function allLines(state: OrderStockState): StockLine[] {
  if (!state.warehouseId) return []
  return [...quantityByLine(state.warehouseId, state.items).values()]
}

function diffLines(oldLines: Map<string, StockLine>, newLines: Map<string, StockLine>, warehouseId: string) {
  const releases: StockLine[] = []
  const reserves: StockLine[] = []
  for (const [key, line] of oldLines) {
    const next = newLines.get(key)?.quantity ?? 0
    if (line.quantity > next) releases.push({ ...line, quantity: line.quantity - next })
  }
  for (const [key, line] of newLines) {
    const previous = oldLines.get(key)?.quantity ?? 0
    if (line.quantity > previous) reserves.push({ ...line, quantity: line.quantity - previous })
  }
  // The maps above are keyed by warehouse, so a warehouse change is a full
  // release plus a full reserve rather than a quantity diff.
  return { releases, reserves, warehouseId }
}

/**
 * Translates one order state change into stock movements. `null` means the
 * order does not exist (creation or hard deletion). A state without a valid
 * warehouse produces no movements, so legacy and manually keyed orders keep
 * behaving exactly as before.
 */
export function planOrderStockTransition(
  before: OrderStockState | null,
  after: OrderStockState | null,
  reference: OrderStockReference,
): PlannedMovement[] {
  const beforeWarehouse = before?.warehouseId && OBJECT_ID.test(before.warehouseId) ? before.warehouseId : null
  const afterWarehouse = after?.warehouseId && OBJECT_ID.test(after.warehouseId) ? after.warehouseId : null

  if (!beforeWarehouse && !afterWarehouse) return []

  const push = (kind: OrderMovementKind, line: StockLine, warehouseId: string) => movements.push({ kind, line, warehouseId, reference })
  const movements: PlannedMovement[] = []

  // Creation.
  if (!before) {
    if (!after || !afterWarehouse) return []
    if (isActive(after.status)) for (const line of allLines(after)) push('reserve', line, afterWarehouse)
    else if (isTerminal(after.status)) for (const line of allLines(after)) push('sell', line, afterWarehouse)
    return movements
  }

  // Deletion: a reservation is dropped, goods already shipped stay shipped.
  if (!after) {
    if (beforeWarehouse && isActive(before.status)) for (const line of allLines(before)) push('release', line, beforeWarehouse)
    return movements
  }

  const beforeLines = beforeWarehouse ? quantityByLine(beforeWarehouse, before.items) : new Map<string, StockLine>()
  const afterLines = afterWarehouse ? quantityByLine(afterWarehouse, after.items) : new Map<string, StockLine>()
  const beforeActive = isActive(before.status)
  const afterActive = isActive(after.status)

  if (beforeActive) {
    if (afterActive) {
      if (beforeWarehouse && afterWarehouse && beforeWarehouse === afterWarehouse) {
        const { releases, reserves } = diffLines(beforeLines, afterLines, beforeWarehouse)
        for (const line of releases) push('release', line, beforeWarehouse)
        for (const line of reserves) push('reserve', line, afterWarehouse)
      } else {
        if (beforeWarehouse) for (const line of allLines(before)) push('release', line, beforeWarehouse)
        if (afterWarehouse) for (const line of allLines(after)) push('reserve', line, afterWarehouse)
      }
      return movements
    }
    if (isTerminal(after.status)) {
      if (beforeWarehouse) for (const line of allLines(before)) push('deduct', line, beforeWarehouse)
      return movements
    }
    // active → cancelled
    if (beforeWarehouse) for (const line of allLines(before)) push('release', line, beforeWarehouse)
    return movements
  }

  if (before.status === 'cancelled') {
    if (afterActive && afterWarehouse) for (const line of allLines(after)) push('reserve', line, afterWarehouse)
    else if (isTerminal(after.status) && afterWarehouse) for (const line of allLines(after)) push('sell', line, afterWarehouse)
    return movements
  }

  if (isTerminal(before.status)) {
    // Returning to active/cancelled puts the goods back on hand.
    if (!afterActive && after.status !== 'cancelled') return []
    if (beforeWarehouse) for (const line of allLines(before)) push('restock', line, beforeWarehouse)
    if (afterActive && afterWarehouse) for (const line of allLines(after)) push('reserve', line, afterWarehouse)
    return movements
  }

  return movements
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `TX-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

async function writeMovementTransaction(
  deps: OrderStockDeps,
  siteId: string,
  movement: PlannedMovement,
  inventoryId: string,
  type: 'export' | 'return_in' | 'return_out' | 'adjustment_inc' | 'adjustment_dec',
  quantityChange: number,
  previousQuantity: number,
  newQuantity: number,
  meta?: OrderStockMeta,
): Promise<void> {
  if (!deps.transactions) return
  await deps.transactions.create({
    siteId,
    code: generatedCode(),
    inventoryId,
    itemId: movement.line.itemId,
    variantId: movement.line.variantId,
    warehouseId: movement.warehouseId,
    type,
    quantityChange,
    previousQuantity,
    newQuantity,
    unitCost: 0,
    totalValue: 0,
    imeiCodes: [],
    referenceId: movement.reference.id,
    referenceCode: movement.reference.code,
    referenceModel: movement.reference.model,
    reason: movement.kind,
    performerId: meta?.actorId ?? null,
    revision: 1,
  })
}

function insufficient(movement: PlannedMovement): InventoryServiceError {
  return new InventoryServiceError(409, 'ORDER_STOCK_INSUFFICIENT', 'Không đủ tồn kho khả dụng cho đơn hàng', {
    itemId: movement.line.itemId,
    variantId: movement.line.variantId,
    warehouseId: movement.warehouseId,
    quantity: movement.line.quantity,
  })
}

async function applyMovement(
  deps: OrderStockDeps,
  siteId: string,
  movement: PlannedMovement,
  meta?: OrderStockMeta,
): Promise<boolean> {
  const { inventory } = deps
  const { line, warehouseId } = movement
  const base = {
    siteId,
    itemId: line.itemId,
    variantId: line.variantId,
    warehouseId,
    isDeleted: { $ne: true },
  }
  const quantity = line.quantity

  if (movement.kind === 'reserve') {
    const updated = await inventory.findOneAndUpdate(
      { ...base, $expr: { $gte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, quantity] } },
      { $inc: { quantityReserved: quantity, revision: 1 } },
      { returnDocument: 'after' },
    ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
    if (!updated) throw insufficient(movement)
    return true
  }

  if (movement.kind === 'release') {
    // Releasing is the safe direction: an order that predates reservations must
    // still be cancellable, so a missing reservation is skipped, not fatal.
    const updated = await inventory.findOneAndUpdate(
      { ...base, quantityReserved: { $gte: quantity } },
      { $inc: { quantityReserved: -quantity, revision: 1 } },
      { returnDocument: 'after' },
    ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
    return Boolean(updated)
  }

  if (movement.kind === 'deduct') {
    const updated = await inventory.findOneAndUpdate(
      { ...base, quantityOnHand: { $gte: quantity }, quantityReserved: { $gte: quantity } },
      { $inc: { quantityOnHand: -quantity, quantityReserved: -quantity, revision: 1 } },
      { returnDocument: 'after' },
    ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
    if (!updated) throw insufficient(movement)
    await writeMovementTransaction(
      deps,
      siteId,
      movement,
      String(updated._id),
      'export',
      -quantity,
      updated.quantityOnHand + quantity,
      updated.quantityOnHand,
      meta,
    )
    return true
  }

  if (movement.kind === 'sell') {
    const updated = await inventory.findOneAndUpdate(
      { ...base, $expr: { $gte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, quantity] } },
      { $inc: { quantityOnHand: -quantity, revision: 1 } },
      { returnDocument: 'after' },
    ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
    if (!updated) throw insufficient(movement)
    await writeMovementTransaction(
      deps,
      siteId,
      movement,
      String(updated._id),
      'export',
      -quantity,
      updated.quantityOnHand + quantity,
      updated.quantityOnHand,
      meta,
    )
    return true
  }

  if (movement.kind === 'restock') {
    const updated = await inventory.findOneAndUpdate(
      base,
      { $inc: { quantityOnHand: quantity, revision: 1 } },
      { returnDocument: 'after' },
    ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
    if (!updated) {
      throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Không tìm thấy tồn kho của sản phẩm trong kho đã chọn', {
        itemId: line.itemId,
        variantId: line.variantId,
        warehouseId,
      })
    }
    await writeMovementTransaction(
      deps,
      siteId,
      movement,
      String(updated._id),
      'return_in',
      quantity,
      updated.quantityOnHand - quantity,
      updated.quantityOnHand,
      meta,
    )
    return true
  }

  // unsell: reverse a restock (cancelled return).
  const updated = await inventory.findOneAndUpdate(
    { ...base, quantityOnHand: { $gte: quantity } },
    { $inc: { quantityOnHand: -quantity, revision: 1 } },
    { returnDocument: 'after' },
  ).lean<(InventoryDocument & { _id: Types.ObjectId }) | null>()
  if (!updated) {
    throw new InventoryServiceError(409, 'INVENTORY_INSUFFICIENT_STOCK', 'Không đủ tồn kho để hoàn tác nhập trả hàng', {
      itemId: line.itemId,
      variantId: line.variantId,
      warehouseId,
    })
  }
  await writeMovementTransaction(
    deps,
    siteId,
    movement,
    String(updated._id),
    'return_out',
    -quantity,
    updated.quantityOnHand + quantity,
    updated.quantityOnHand,
    meta,
  )
  return true
}

function inverseOf(movement: PlannedMovement): PlannedMovement | null {
  switch (movement.kind) {
    case 'reserve':
      return { ...movement, kind: 'release' }
    case 'release':
      return { ...movement, kind: 'reserve' }
    case 'deduct':
      return { ...movement, kind: 'restock' }
    case 'sell':
      return { ...movement, kind: 'restock' }
    case 'restock':
      return { ...movement, kind: 'unsell' }
    case 'unsell':
      return { ...movement, kind: 'restock' }
    default:
      return null
  }
}

/**
 * Applies a whole transition and returns an undo function. Callers that fail
 * after the stock write (revision conflict, validation) run the undo so the
 * database never keeps a half-applied transition.
 */
export async function applyOrderStockTransition(
  deps: OrderStockDeps,
  siteId: string,
  before: OrderStockState | null,
  after: OrderStockState | null,
  reference: OrderStockReference,
  meta?: OrderStockMeta,
): Promise<() => Promise<void>> {
  const movements = planOrderStockTransition(before, after, reference)
  if (movements.length === 0) return async () => {}

  const undo: PlannedMovement[] = []
  try {
    for (const movement of movements) {
      const applied = await applyMovement(deps, siteId, movement, meta)
      if (!applied) continue
      const inverse = inverseOf(movement)
      if (inverse) undo.push(inverse)
    }
  } catch (error) {
    await rollback(deps, siteId, undo, meta)
    throw error
  }

  return async () => {
    await rollback(deps, siteId, undo.reverse(), meta)
  }
}

async function rollback(deps: OrderStockDeps, siteId: string, movements: PlannedMovement[], meta?: OrderStockMeta) {
  for (const movement of movements) {
    try {
      await applyMovement(deps, siteId, movement, meta)
    } catch (error) {
      console.warn(`[order-stock] rollback failed for ${movement.kind} ${movement.line.itemId}: ${(error as Error).message}`)
    }
  }
}

/** Restocks (`direction: 1`) or reverses (`-1`) the lines of an order return. */
export async function applyOrderReturnStock(
  deps: OrderStockDeps,
  siteId: string,
  order: OrderDocument | null,
  items: OrderStockState['items'],
  direction: 1 | -1,
  reference: OrderStockReference,
  meta?: OrderStockMeta,
): Promise<() => Promise<void>> {
  if (!order || !isTerminal(order.status)) return async () => {}
  const state: OrderStockState = {
    warehouseId: order.warehouseId ?? null,
    status: order.status,
    items,
  }
  const warehouseId = state.warehouseId && OBJECT_ID.test(state.warehouseId) ? state.warehouseId : null
  if (!warehouseId) return async () => {}

  const movements: PlannedMovement[] = allLines(state).map(line => ({
    kind: direction === 1 ? 'restock' : 'unsell',
    line,
    warehouseId,
    reference,
  }))
  if (movements.length === 0) return async () => {}

  const undo: PlannedMovement[] = []
  try {
    for (const movement of movements) {
      await applyMovement(deps, siteId, movement, meta)
      const inverse = inverseOf(movement)
      if (inverse) undo.push(inverse)
    }
  } catch (error) {
    await rollback(deps, siteId, undo, meta)
    throw error
  }

  return async () => {
    await rollback(deps, siteId, undo.reverse(), meta)
  }
}

export function orderStockStateOf(order: Pick<OrderDocument, 'warehouseId' | 'status' | 'items'>): OrderStockState {
  return {
    warehouseId: order.warehouseId ?? null,
    status: order.status,
    items: order.items ?? [],
  }
}
