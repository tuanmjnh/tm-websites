import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { CustomerDocument } from '../models/customer'
import type { OrderDocument } from '../models/order'

export class CustomerPortalServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CustomerPortalServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export interface PortalOrderSummary {
  id: string
  code: string
  status: string
  totalAmount: number
}

function toOrderSummary(row: OrderDocument & { _id: Types.ObjectId }): PortalOrderSummary {
  return { id: String(row._id), code: row.code, status: row.status, totalAmount: row.totalAmount }
}

export interface PortalCustomer {
  id: string
  code: string
  fullName: string
  email: string
  phone: string
  loyaltyPoints: number
}

export async function resolveCustomerBySubject(
  customerModel: Model<CustomerDocument>,
  siteId: string,
  subjectId: string,
): Promise<PortalCustomer> {
  const record = await customerModel.findOne({ siteId, subjectId, isDeleted: { $ne: true } }).lean<CustomerDocument & { _id: Types.ObjectId } | null>()
  if (!record) throw new CustomerPortalServiceError(404, 'PORTAL_CUSTOMER_NOT_FOUND', 'No customer is linked to this account')
  return {
    id: String(record._id),
    code: record.code,
    fullName: record.fullName ?? '',
    email: record.email ?? '',
    phone: record.phone ?? '',
    loyaltyPoints: record.loyaltyPoints ?? 0,
  }
}

export async function listOrdersForSubject(
  orderModel: Model<OrderDocument>,
  customerModel: Model<CustomerDocument>,
  siteId: string,
  subjectId: string,
  params: { cursor?: string, limit?: number } = {},
): Promise<{ customerId: string, data: PortalOrderSummary[], nextCursor: string | null, hasMore: boolean }> {
  const customer = await resolveCustomerBySubject(customerModel, siteId, subjectId)
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), 100)
  const filter: Record<string, unknown> = { siteId, customerId: new Types.ObjectId(customer.id), isDeleted: { $ne: true } }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }
  const rows = await orderModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<(OrderDocument & { _id: Types.ObjectId })[]>()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    customerId: customer.id,
    data: page.map(toOrderSummary),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
  }
}

export async function getOrderForSubject(
  orderModel: Model<OrderDocument>,
  customerModel: Model<CustomerDocument>,
  siteId: string,
  subjectId: string,
  orderId: string,
): Promise<PortalOrderSummary> {
  const customer = await resolveCustomerBySubject(customerModel, siteId, subjectId)
  if (!Types.ObjectId.isValid(orderId)) throw new CustomerPortalServiceError(422, 'PORTAL_ORDER_ID_INVALID', 'Order id is not valid')
  const row = await orderModel.findOne({ _id: new Types.ObjectId(orderId), siteId, customerId: new Types.ObjectId(customer.id) }).lean<OrderDocument & { _id: Types.ObjectId } | null>()
  if (!row) throw new CustomerPortalServiceError(404, 'PORTAL_ORDER_NOT_FOUND', 'Order not found for this account')
  return toOrderSummary(row)
}