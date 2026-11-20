import mongoose, { type Model } from 'mongoose'

const { Schema, model } = mongoose

/**
 * Write/read side of the storefront checkout.
 *
 * The CMS owns `crm_orders`, `crm_customers` and `audit_logs`; the storefront
 * only writes the allowlisted fields below and never validates or reshapes a
 * CMS-owned document. The schemas stay `strict: false` so a CMS column the
 * storefront does not know about is preserved instead of stripped, and the
 * timestamps are set explicitly because checkout is a plain insert, not a
 * Mongoose-managed update.
 */

export type CheckoutDoc = Record<string, unknown>

const loose = { type: Schema.Types.Mixed }

const sharedOptions = {
  strict: false,
  versionKey: false,
  timestamps: false,
  minimize: false,
} as const

const orderSchema = new Schema<CheckoutDoc>(
  {
    siteId: String,
    code: String,
    customerId: loose,
    channel: String,
    status: String,
    paymentStatus: String,
    paymentMethod: String,
    currency: String,
    items: loose,
    itemsPrice: Number,
    shippingFee: Number,
    discountAmount: Number,
    totalAmount: Number,
    paidAmount: Number,
    shippingAddress: loose,
    note: String,
    warehouseId: loose,
    history: loose,
    isDeleted: Boolean,
    deletedAt: loose,
    revision: Number,
    schemaVersion: Number,
    createdAt: loose,
    updatedAt: loose,
  },
  { ...sharedOptions, collection: 'crm_orders' }
)

const customerSchema = new Schema<CheckoutDoc>(
  {
    email: loose,
    phone: loose,
    isDeleted: loose,
  },
  { ...sharedOptions, collection: 'crm_customers' }
)

const auditSchema = new Schema<CheckoutDoc>(
  {
    siteId: String,
    resourceType: String,
    resourceId: String,
    resourceKey: String,
    action: String,
    revision: Number,
    fromStatus: loose,
    toStatus: loose,
    changedFields: loose,
    reason: loose,
    actor: loose,
    requestId: loose,
    createdAt: loose,
  },
  { ...sharedOptions, collection: 'audit_logs' }
)

export const PublicCheckoutOrderModel: Model<CheckoutDoc> =
  mongoose.models.PublicCheckoutOrder ?? model<CheckoutDoc>('PublicCheckoutOrder', orderSchema)

export const PublicCheckoutCustomerModel: Model<CheckoutDoc> =
  mongoose.models.PublicCheckoutCustomer ?? model<CheckoutDoc>('PublicCheckoutCustomer', customerSchema)

export const PublicCheckoutAuditModel: Model<CheckoutDoc> =
  mongoose.models.PublicCheckoutAudit ?? model<CheckoutDoc>('PublicCheckoutAudit', auditSchema)
