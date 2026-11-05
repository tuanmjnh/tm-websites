export const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

export const TRANSACTION_TYPES = ['in', 'out'] as const
export type TransactionType = typeof TRANSACTION_TYPES[number]

export const TRANSACTION_SOURCES = ['pos', 'portal', 'admin', 'import'] as const
export type TransactionSource = typeof TRANSACTION_SOURCES[number]

export const PARTNER_TYPES = ['Customer', 'Supplier', 'Employee', 'Other'] as const
export type PartnerType = typeof PARTNER_TYPES[number]

export const TRANSACTION_STATUSES = ['pending', 'completed', 'failed'] as const
export type TransactionStatus = typeof TRANSACTION_STATUSES[number]

export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

export const PURCHASE_ORDER_STATUSES = ['draft', 'ordered', 'receiving', 'pending', 'completed', 'cancelled'] as const
export type PurchaseOrderStatus = typeof PURCHASE_ORDER_STATUSES[number]

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'partial', 'refunded'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

export const REF_MODELS = ['Order', 'PurchaseOrder', 'Other', 'None'] as const
export type RefModel = typeof REF_MODELS[number]

export const PAYMENT_TYPES = ['debt', 'now', 'partial'] as const
export type PaymentType = typeof PAYMENT_TYPES[number]

export const INVENTORY_TRANSACTION_TYPES = [
  'import', 'export', 'return_in', 'return_out', 'transfer_in', 'transfer_out', 'adjustment_inc', 'adjustment_dec'
] as const
export type InventoryTransactionType = typeof INVENTORY_TRANSACTION_TYPES[number]

export const INVENTORY_REF_MODELS = ['PurchaseOrder', 'Order', 'InventoryTransfer', 'InventoryAdjustment'] as const
export type InventoryRefModel = typeof INVENTORY_REF_MODELS[number]

export const PAYMENT_GATEWAY_METHODS = ['cod', 'banking', 'momo', 'stripe', 'paypal'] as const
export type PaymentGatewayMethod = typeof PAYMENT_GATEWAY_METHODS[number]

export const PAYMENT_GATEWAY_STATUSES = ['pending', 'processing', 'success', 'failed', 'refunded', 'expired'] as const
export type PaymentGatewayStatus = typeof PAYMENT_GATEWAY_STATUSES[number]

export const SYSTEM_ID = '000000000000000000000001' as const

export const QUOTATION_STATUSES = [
  'draft',
  'submitted',
  'quoted',
  'revision_requested',
  'confirmed',
  'converted',
  'rejected',
  'expired',
  'cancelled'
] as const
export type QuotationStatus = typeof QUOTATION_STATUSES[number]

export const SHIPPING_CARRIERS = ['viettel_post', 'vnpost', 'spx_express', 'manual'] as const
export type ShippingCarrierCode = typeof SHIPPING_CARRIERS[number]

export const SHIPMENT_STATUSES = [
  'ready_to_pick', 'picking', 'picked', 'in_transit',
  'out_for_delivery', 'delivered', 'delivery_failed',
  'returning', 'returned', 'cancelled'
] as const
export type ShipmentStatus = typeof SHIPMENT_STATUSES[number]