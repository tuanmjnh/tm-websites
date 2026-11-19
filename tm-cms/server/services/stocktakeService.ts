import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { StocktakeDocument, StocktakeLine, StocktakeStatus } from '../models/stocktake'
import { StocktakeInvariantError, normalizeStocktakeInput } from '../models/stocktake'
import { recordInventoryTransaction, InventoryTransactionServiceError } from './inventoryTransactionService'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'


/**
 * Stocktake (INV-02): count a warehouse, compare it to the ledger, and book the
 * difference as an adjustment. A draft is editable and cancellable; once
 * completed it is immutable, because the adjustment rows it created are the
 * record of what changed.
 */

export class StocktakeServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'StocktakeServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export interface StocktakeAdmin {
  id: string
  code: string
  warehouseId: string
  status: StocktakeStatus
  lines: StocktakeLine[]
  note: string
  completedAt: string | null
  revision: number
  updatedAt: string | null
}

export interface StocktakeRecord extends StocktakeDocument {
  _id: Types.ObjectId
}

export function toAdminStocktake(record: StocktakeRecord): StocktakeAdmin {
  return {
    id: String(record._id),
    code: record.code,
    warehouseId: record.warehouseId,
    status: record.status,
    lines: (record.lines ?? []).map(line => ({ ...line })),
    note: record.note ?? '',
    completedAt: record.completedAt ? new Date(record.completedAt).toISOString() : null,
    revision: record.revision ?? 1,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
  }
}

function throwInvariant(error: unknown): never {
  if (error instanceof StocktakeInvariantError) {
    throw new StocktakeServiceError(422, error.code, error.message)
  }
  throw error
}

export async function createStocktake(
  model: Model<StocktakeDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ stocktake: StocktakeAdmin, created: boolean }> {
  let draft
  try {
    draft = normalizeStocktakeInput(input)
  } catch (error) {
    throwInvariant(error)
  }

  const existing = await model.findOne({ siteId, code: draft.code }).lean<StocktakeRecord | null>()
  if (existing && existing.status !== 'cancelled') {
    throw new StocktakeServiceError(409, 'STOCKTAKE_CODE_TAKEN', `Mã kiểm kê "${draft.code}" đã tồn tại`)
  }

  let record: StocktakeRecord
  if (existing) {
    record = (await model.findOneAndUpdate(
      { _id: existing._id, siteId },
      {
        $set: {
          warehouseId: draft.warehouseId,
          note: draft.note,
          lines: draft.lines,
          status: 'draft',
          completedAt: null,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<StocktakeRecord | null>())!
  } else {
    record = (await model.create({ ...draft, siteId, status: 'draft' })).toObject() as StocktakeRecord
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'stocktake',
    resourceId: String(record._id),
    resourceKey: record.code,
    action: existing ? 'restore' : 'create',
    revision: record.revision ?? 1,
    fromStatus: existing ? 'cancelled' : null,
    toStatus: 'draft',
    changedFields: ['code', 'warehouseId', 'lines', 'note'],
  })

  return { stocktake: toAdminStocktake(record), created: !existing }
}

export async function listStocktakes(
  model: Model<StocktakeDocument>,
  siteId: string,
  params: { status?: StocktakeStatus | null, warehouseId?: string | null } = {},
): Promise<{ data: StocktakeAdmin[], summary: { draft: number, completed: number, cancelled: number } }> {
  const filter: Record<string, unknown> = { siteId }
  if (params.status) filter.status = params.status
  if (params.warehouseId) filter.warehouseId = params.warehouseId

  const records = await model.find(filter).sort({ createdAt: -1 }).limit(200).lean<StocktakeRecord[]>()
  const all = await model.find({ siteId }).select({ status: 1 }).lean<{ status: StocktakeStatus }[]>()
  const summary = { draft: 0, completed: 0, cancelled: 0 }
  for (const row of all) summary[row.status] += 1

  return { data: records.map(toAdminStocktake), summary }
}

export async function getStocktake(
  model: Model<StocktakeDocument>,
  siteId: string,
  id: string,
): Promise<StocktakeAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new StocktakeServiceError(422, 'STOCKTAKE_ID_INVALID', 'Mã kiểm kê không hợp lệ')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StocktakeRecord | null>()
  if (!record) throw new StocktakeServiceError(404, 'STOCKTAKE_NOT_FOUND', 'Không tìm thấy phiếu kiểm kê')
  return toAdminStocktake(record)
}

export interface CompleteStocktakeInput {
  revision?: unknown
  lines?: unknown
}

/**
 * Completing a stocktake is the moment the physical count becomes ledger truth:
 * every line with a difference gets an adjustment transaction, and the balance
 * moves under its revision. A line whose balance does not exist is created at
 * zero first, so a count of stock that was never recorded is still captured.
 */
export async function completeStocktake(
  stocktakeModel: Model<StocktakeDocument>,
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  siteId: string,
  id: string,
  input: CompleteStocktakeInput,
  meta?: { audit?: ContentAuditMeta },
): Promise<StocktakeAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new StocktakeServiceError(422, 'STOCKTAKE_ID_INVALID', 'Mã kiểm kê không hợp lệ')

  const record = await stocktakeModel.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StocktakeRecord | null>()
  if (!record) throw new StocktakeServiceError(404, 'STOCKTAKE_NOT_FOUND', 'Không tìm thấy phiếu kiểm kê')
  if (record.status !== 'draft') {
    throw new StocktakeServiceError(409, 'STOCKTAKE_LOCKED', `Phiếu kiểm kê đã ${record.status}`, { status: record.status })
  }

  const revision = Number(input?.revision)
  if (!Number.isInteger(revision) || revision < 1 || revision !== (record.revision ?? 1)) {
    throw new StocktakeServiceError(409, 'STOCKTAKE_REVISION_CONFLICT', 'Phiếu kiểm kê đã được người khác sửa, hãy tải lại', {
      expected: record.revision,
    })
  }

  const overrides = Array.isArray(input?.lines) ? input.lines : null
  const overrideMap = new Map<string, number>()
  if (overrides) {
    for (const raw of overrides) {
      const entry = (raw ?? {}) as Record<string, unknown>
      const key = `${String(entry.itemId ?? '').trim()}::${String(entry.variantId ?? '').trim()}`
      const counted = Number(entry.countedQuantity)
      if (!Number.isInteger(counted) || counted < 0) {
        throw new StocktakeServiceError(422, 'STOCKTAKE_COUNT_INVALID', 'Số lượng kiểm đếm phải là số nguyên không âm', { key })
      }
      overrideMap.set(key, counted)
    }
  }

  const nextLines: StocktakeLine[] = []
  for (const line of record.lines ?? []) {
    const key = `${line.itemId}::${String(line.variantId ?? '').trim()}`
    const counted = overrideMap.has(key) ? (overrideMap.get(key) as number) : (line.countedQuantity ?? 0)
    if (!Number.isInteger(counted) || counted < 0) {
      throw new StocktakeServiceError(422, 'STOCKTAKE_COUNT_INVALID', 'Số lượng kiểm đếm phải là số nguyên không âm', { key })
    }

    let inventory = await inventoryModel.findOne({
      siteId,
      itemId: line.itemId,
      variantId: line.variantId ?? null,
      warehouseId: record.warehouseId,
      isDeleted: { $ne: true },
    }).lean<InventoryDocument & { _id: Types.ObjectId } | null>()

    if (!inventory) {
      inventory = (await inventoryModel.create({
        siteId,
        itemId: line.itemId,
        variantId: line.variantId ?? null,
        warehouseId: record.warehouseId,
        sku: line.sku ?? '',
        quantityOnHand: 0,
        quantityReserved: 0,
        binLocation: '',
        lowStockThreshold: 0,
        revision: 1,
      })).toObject() as InventoryDocument & { _id: Types.ObjectId }
    }

    const expected = inventory.quantityOnHand ?? 0
    const difference = counted - expected

    if (difference !== 0) {
      try {
        await recordInventoryTransaction(inventoryModel, transactionModel, siteId, {
          itemId: line.itemId,
          variantId: line.variantId ?? null,
          warehouseId: record.warehouseId,
          type: difference > 0 ? 'adjustment_inc' : 'adjustment_dec',
          quantityChange: difference,
          unitCost: 0,
          referenceModel: 'Stocktake',
          referenceId: String(record._id),
          referenceCode: record.code,
          reason: `Kiểm kê ${record.code}`,
        }, meta)
      } catch (error) {
        if (error instanceof InventoryTransactionServiceError) {
          throw new StocktakeServiceError(error.statusCode, error.code, error.message, error.details)
        }
        throw new StocktakeServiceError(422, 'STOCKTAKE_ADJUSTMENT_FAILED', 'Không thể điều chỉnh tồn kho theo kiểm kê', {
          itemId: line.itemId,
          cause: (error as Error).message,
        })
      }
    }

    nextLines.push({
      ...line,
      expectedQuantity: expected,
      countedQuantity: counted,
      difference,
    })
  }

  const updated = await stocktakeModel.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    {
      $set: {
        status: 'completed',
        lines: nextLines,
        completedAt: new Date(),
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<StocktakeRecord | null>()

  if (!updated) {
    throw new StocktakeServiceError(409, 'STOCKTAKE_REVISION_CONFLICT', 'Phiếu kiểm kê đã được người khác sửa, hãy tải lại')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'stocktake',
    resourceId: id,
    resourceKey: record.code,
    action: 'update',
    revision: updated.revision ?? 1,
    fromStatus: 'draft',
    toStatus: 'completed',
    changedFields: ['status', 'lines', 'completedAt'],
  })

  return toAdminStocktake(updated)
}

export async function cancelStocktake(
  model: Model<StocktakeDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) throw new StocktakeServiceError(422, 'STOCKTAKE_ID_INVALID', 'Mã kiểm kê không hợp lệ')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StocktakeRecord | null>()
  if (!record) throw new StocktakeServiceError(404, 'STOCKTAKE_NOT_FOUND', 'Không tìm thấy phiếu kiểm kê')
  if (record.status !== 'draft') {
    throw new StocktakeServiceError(409, 'STOCKTAKE_LOCKED', `Phiếu kiểm kê đã ${record.status}`, { status: record.status })
  }

  await model.updateOne(
    { _id: record._id, siteId, status: 'draft' },
    { $set: { status: 'cancelled' }, $inc: { revision: 1 } },
  )

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'stocktake',
    resourceId: id,
    resourceKey: record.code,
    action: 'cancel',
    revision: (record.revision ?? 1) + 1,
    fromStatus: 'draft',
    toStatus: 'cancelled',
    changedFields: ['status'],
  })

  return { id }
}
