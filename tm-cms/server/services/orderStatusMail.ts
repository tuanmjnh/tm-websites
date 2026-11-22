import type { Model } from 'mongoose'
import type { CustomerDocument } from '../models/customer'
import type { MailDeliveryDocument } from '../models/mailDelivery'
import type { MailTemplateDocument } from '../models/mailTemplate'
import type { OrderAddress, OrderItem, OrderStatus } from '../models/order'
import { MailServiceError, queueMail } from './mailService'

/**
 * "Your order moved" notification.
 *
 * The status change is the business event; the mail is a side effect of it, so a
 * missing template, an order without an address or a queue failure must never
 * fail the update. The dedupe key is one key per transition, which keeps a
 * retried save — or a status an order returns to — from mailing the customer
 * twice for the same step.
 */

export const ORDER_STATUS_TEMPLATE = 'order-status'

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Chờ xác nhận',
  processing: 'Đang xử lý',
  shipped: 'Đang giao hàng',
  completed: 'Hoàn tất',
  cancelled: 'Đã huỷ',
}

/** The template substitutes tokens only, so the label comes pre-translated. */
export function orderStatusLabel(status: string): string {
  return STATUS_LABELS[status as OrderStatus] ?? status
}

export interface OrderStatusMailModels {
  delivery: Model<MailDeliveryDocument>
  template: Model<MailTemplateDocument>
  /** Used only to resolve an address for an order that has none of its own. */
  customer?: Model<CustomerDocument> | null
}

export interface OrderStatusMailOrder {
  code: string
  status: string
  currency: string
  totalAmount: number
  items: OrderItem[]
  shippingAddress: OrderAddress
  /** Where checkout sent the confirmation; absent on an order placed in the CMS. */
  customerEmail?: string
  customerId?: unknown
}

const MONEY_LOCALE = 'vi-VN'

function money(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency: currency || 'VND',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function orderStatusVariables(order: OrderStatusMailOrder): Record<string, string> {
  const currency = order.currency || 'VND'
  const items = (order.items ?? []).map(
    item => `${item.quantity} × ${item.itemName.trim() || 'Sản phẩm'} — ${money(item.price, currency)}`,
  )

  return {
    orderCode: order.code,
    name: order.shippingAddress?.fullName?.trim() || 'Quý khách',
    status: order.status,
    statusLabel: orderStatusLabel(order.status),
    itemCount: String((order.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0)),
    items: items.join('\n'),
    total: money(order.totalAmount, currency),
  }
}

export function orderStatusDedupeKey(orderCode: string, status: string): string {
  return `${ORDER_STATUS_TEMPLATE}:${status}:${orderCode}`.slice(0, 120)
}

async function recipientEmail(
  models: OrderStatusMailModels,
  siteId: string,
  order: OrderStatusMailOrder,
): Promise<string> {
  const stored = (order.customerEmail ?? '').trim().toLowerCase()
  if (stored) return stored
  if (!models.customer || !order.customerId) return ''

  const customer = await models.customer
    .findOne({ _id: order.customerId, siteId, isDeleted: { $ne: true } })
    .select('email')
    .lean<{ email?: string } | null>()

  return (customer?.email ?? '').trim().toLowerCase()
}

/**
 * Queue the customer's notice for the order's current status. Answers `false`
 * whenever nothing reached the queue (no address, no active template, missing
 * variables); an unexpected queue failure is left to the caller to log.
 */
export async function queueOrderStatusMail(
  models: OrderStatusMailModels,
  siteId: string,
  order: OrderStatusMailOrder,
): Promise<boolean> {
  const to = await recipientEmail(models, siteId, order)
  if (!to) return false

  try {
    await queueMail(models.delivery, models.template, siteId, {
      templateCode: ORDER_STATUS_TEMPLATE,
      locale: 'vi',
      to,
      variables: orderStatusVariables(order),
      dedupeKey: orderStatusDedupeKey(order.code, order.status),
    })
  } catch (error) {
    // A template the operator has not authored yet is configuration, not a
    // failure of the order update.
    if (error instanceof MailServiceError) return false
    throw error
  }

  return true
}
