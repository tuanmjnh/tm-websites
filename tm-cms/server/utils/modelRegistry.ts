import type { H3Event } from 'h3'
import type { Connection, Model } from 'mongoose'
import type { AuditEntryDocument } from '../models/audit'
import type { ContentDocument } from '../models/content'
import type { IdempotencyRecordDocument } from '../models/idempotency'
import type { CategoryDocument } from '../models/category'
import type { MediaDocument } from '../models/media'
import type { SiteSettingsDocument } from '../models/settings'
import type { MenuDocument } from '../models/menu'
import type { ContentRevisionDocument } from '../models/revision'
import type { CatalogCategoryDocument, CatalogItemDocument } from '../models/catalog'
import type { CustomerDocument } from '../models/customer'
import type { CustomerSegmentDocument } from '../models/customerSegment'
import type { OrderDocument } from '../models/order'
import type { QuotationDocument } from '../models/quotation'
import type { DocumentTemplateDocument } from '../models/documentTemplate'
import type { WarehouseDocument } from '../models/warehouse'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { SupplierDocument } from '../models/supplier'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'
import type { PaymentDocument } from '../models/payment'
import type { InventoryTransferDocument } from '../models/inventoryTransfer'
import type { NotificationDocument } from '../models/notification'
import type { NotificationSubscriptionDocument } from '../models/notificationSubscription'
import type { MailTemplateDocument } from '../models/mailTemplate'
import type { MailDeliveryDocument } from '../models/mailDelivery'
import type { NewsletterSubscriptionDocument } from '../models/newsletterSubscription'
import type { ContactMessageDocument } from '../models/contactMessage'
import type { ShipmentDocument } from '../models/shipment'
import type { OrderReturnDocument } from '../models/orderReturn'
import type { SerialNumberDocument } from '../models/serialNumber'
import type { PushSubscriptionDocument } from '../models/pushSubscription'
import type { JobDocument } from '../models/job'
import type { TaskDocument } from '../models/task'
import type { PayableDocument } from '../models/payable'
import type { RedirectDocument } from '../models/redirect'
import { auditModel, syncAuditIndexes } from '../models/audit'
import { contentModel, syncContentIndexes } from '../models/content'
import { idempotencyModel, syncIdempotencyIndexes } from '../models/idempotency'
import { categoryModel, syncCategoryIndexes } from '../models/category'
import { mediaModel, syncMediaIndexes } from '../models/media'
import { siteSettingsModel, syncSettingsIndexes } from '../models/settings'
import { menuModel, syncMenuIndexes } from '../models/menu'
import { contentRevisionModel, syncContentRevisionIndexes } from '../models/revision'
import { catalogCategoryModel, catalogItemModel, syncCatalogIndexes } from '../models/catalog'
import { customerModel, syncCustomerIndexes } from '../models/customer'
import { customerSegmentModel, syncCustomerSegmentIndexes } from '../models/customerSegment'
import { orderModel, syncOrderIndexes } from '../models/order'
import { quotationModel, syncQuotationIndexes } from '../models/quotation'
import { documentTemplateModel, syncDocumentTemplateIndexes } from '../models/documentTemplate'
import { warehouseModel, syncWarehouseIndexes } from '../models/warehouse'
import { inventoryModel, syncInventoryIndexes } from '../models/inventory'
import { inventoryTransactionModel, syncInventoryTransactionIndexes } from '../models/inventoryTransaction'
import { supplierModel, syncSupplierIndexes } from '../models/supplier'
import { purchaseOrderModel, syncPurchaseOrderIndexes } from '../models/purchaseOrder'
import { paymentModel, syncPaymentIndexes } from '../models/payment'
import { inventoryTransferModel, syncInventoryTransferIndexes } from '../models/inventoryTransfer'
import { notificationModel, syncNotificationIndexes } from '../models/notification'
import {
  notificationSubscriptionModel,
  syncNotificationSubscriptionIndexes,
} from '../models/notificationSubscription'
import { mailTemplateModel, syncMailTemplateIndexes } from '../models/mailTemplate'
import { mailDeliveryModel, syncMailDeliveryIndexes } from '../models/mailDelivery'
import { newsletterSubscriptionModel, syncNewsletterSubscriptionIndexes } from '../models/newsletterSubscription'
import { contactMessageModel, syncContactMessageIndexes } from '../models/contactMessage'
import { shipmentModel, syncShipmentIndexes } from '../models/shipment'
import { orderReturnModel, syncOrderReturnIndexes } from '../models/orderReturn'
import { serialNumberModel, syncSerialNumberIndexes } from '../models/serialNumber'
import { pushSubscriptionModel, syncPushSubscriptionIndexes } from '../models/pushSubscription'
import { jobModel, syncJobIndexes } from '../models/job'
import { taskModel, syncTaskIndexes } from '../models/task'
import { payableModel, syncPayableIndexes } from '../models/payable'
import type { StaffProfileDocument } from '../models/staffProfile'
import type { AttendanceDocument } from '../models/attendance'
import type { SalaryConfigDocument } from '../models/salaryConfig'
import type { PayrollDocument } from '../models/payroll'
import { staffProfileModel, syncStaffProfileIndexes } from '../models/staffProfile'
import { attendanceModel, syncAttendanceIndexes } from '../models/attendance'
import { salaryConfigModel, syncSalaryConfigIndexes } from '../models/salaryConfig'
import { payrollModel, syncPayrollIndexes } from '../models/payroll'
import type { StocktakeDocument } from '../models/stocktake'
import { stocktakeModel, syncStocktakeIndexes } from '../models/stocktake'
import type { ShiftTemplateDocument } from '../models/shiftTemplate'
import type { ShiftAssignmentDocument } from '../models/shiftAssignment'
import { shiftTemplateModel, syncShiftTemplateIndexes } from '../models/shiftTemplate'
import { shiftAssignmentModel, syncShiftAssignmentIndexes } from '../models/shiftAssignment'
import { redirectModel, syncRedirectIndexes } from '../models/redirect'
import { MIGRATIONS, applyMigrations } from '../models/migrations'
import { withCustomerDb } from './database'

/**
 * Models are registered per connection, and each connection is prepared once
 * per process. A second customer served from the same process gets its own
 * registration, so nothing here depends on a global mongoose model table.
 */

export interface PreparedModels {
  Content: Model<ContentDocument>
  Audit: Model<AuditEntryDocument>
  IdempotencyKey: Model<IdempotencyRecordDocument>
  Revision: Model<ContentRevisionDocument>
  Category: Model<CategoryDocument>
  Media: Model<MediaDocument>
  Settings: Model<SiteSettingsDocument>
  Menu: Model<MenuDocument>
  CatalogItem: Model<CatalogItemDocument>
  CatalogCategory: Model<CatalogCategoryDocument>
  Redirect: Model<RedirectDocument>
  Customer: Model<CustomerDocument>
  CustomerSegment: Model<CustomerSegmentDocument>
  Order: Model<OrderDocument>
  Quotation: Model<QuotationDocument>
  DocumentTemplate: Model<DocumentTemplateDocument>
  Warehouse: Model<WarehouseDocument>
  Inventory: Model<InventoryDocument>
  InventoryTransaction: Model<InventoryTransactionDocument>
  Supplier: Model<SupplierDocument>
  PurchaseOrder: Model<PurchaseOrderDocument>
  Payment: Model<PaymentDocument>
  InventoryTransfer: Model<InventoryTransferDocument>
  Notification: Model<NotificationDocument>
  NotificationSubscription: Model<NotificationSubscriptionDocument>
  MailTemplate: Model<MailTemplateDocument>
  MailDelivery: Model<MailDeliveryDocument>
  NewsletterSubscription: Model<NewsletterSubscriptionDocument>
  ContactMessage: Model<ContactMessageDocument>
  Shipment: Model<ShipmentDocument>
  OrderReturn: Model<OrderReturnDocument>
  SerialNumber: Model<SerialNumberDocument>
  PushSubscription: Model<PushSubscriptionDocument>
  Job: Model<JobDocument>
  Task: Model<TaskDocument>
  Payable: Model<PayableDocument>
  StaffProfile: Model<StaffProfileDocument>
  Attendance: Model<AttendanceDocument>
  SalaryConfig: Model<SalaryConfigDocument>
  Payroll: Model<PayrollDocument>
  Stocktake: Model<StocktakeDocument>
  ShiftTemplate: Model<ShiftTemplateDocument>
  ShiftAssignment: Model<ShiftAssignmentDocument>
}

const preparation = new WeakMap<Connection, Promise<PreparedModels>>()

async function prepare(connection: Connection, now: Date): Promise<PreparedModels> {
  const migrations = await applyMigrations(connection, MIGRATIONS, now)
  // Index creation is a migration, but an operator may have dropped an index
  // outside the app; `createIndexes()` only adds what is missing.
  await syncContentIndexes(connection)
  await syncAuditIndexes(connection)
  await syncIdempotencyIndexes(connection)
  await syncContentRevisionIndexes(connection)
  await syncCategoryIndexes(connection)
  await syncMediaIndexes(connection)
  await syncSettingsIndexes(connection)
  await syncMenuIndexes(connection)
  await syncCatalogIndexes(connection)
  await syncRedirectIndexes(connection)
  await syncCustomerIndexes(connection)
  await syncCustomerSegmentIndexes(connection)
  await syncOrderIndexes(connection)
  await syncQuotationIndexes(connection)
  await syncDocumentTemplateIndexes(connection)
  await syncWarehouseIndexes(connection)
  await syncInventoryIndexes(connection)
  await syncInventoryTransactionIndexes(connection)
  await syncSupplierIndexes(connection)
  await syncPurchaseOrderIndexes(connection)
  await syncPaymentIndexes(connection)
  await syncInventoryTransferIndexes(connection)
  await syncNotificationIndexes(connection)
  await syncNotificationSubscriptionIndexes(connection)
  await syncMailTemplateIndexes(connection)
  await syncMailDeliveryIndexes(connection)
  await syncNewsletterSubscriptionIndexes(connection)
  await syncContactMessageIndexes(connection)
  await syncShipmentIndexes(connection)
  await syncOrderReturnIndexes(connection)
  await syncSerialNumberIndexes(connection)
  await syncPushSubscriptionIndexes(connection)
  await syncJobIndexes(connection)
  await syncTaskIndexes(connection)
  await syncPayableIndexes(connection)
  await syncStaffProfileIndexes(connection)
  await syncAttendanceIndexes(connection)
  await syncSalaryConfigIndexes(connection)
  await syncPayrollIndexes(connection)
  await syncStocktakeIndexes(connection)
  await syncShiftTemplateIndexes(connection)
  await syncShiftAssignmentIndexes(connection)

  if (migrations.applied.length > 0) {
    console.info(`[tm-db] applied migrations: ${migrations.applied.join(', ')}`)
  }

  return {
    Content: contentModel(connection),
    Audit: auditModel(connection),
    IdempotencyKey: idempotencyModel(connection),
    Revision: contentRevisionModel(connection),
    Category: categoryModel(connection),
    Media: mediaModel(connection),
    Settings: siteSettingsModel(connection),
    Menu: menuModel(connection),
    CatalogItem: catalogItemModel(connection),
    CatalogCategory: catalogCategoryModel(connection),
    Redirect: redirectModel(connection),
    Customer: customerModel(connection),
    CustomerSegment: customerSegmentModel(connection),
    Order: orderModel(connection),
    Quotation: quotationModel(connection),
    DocumentTemplate: documentTemplateModel(connection),
    Warehouse: warehouseModel(connection),
    Inventory: inventoryModel(connection),
    InventoryTransaction: inventoryTransactionModel(connection),
    Supplier: supplierModel(connection),
    PurchaseOrder: purchaseOrderModel(connection),
    Payment: paymentModel(connection),
    InventoryTransfer: inventoryTransferModel(connection),
    Notification: notificationModel(connection),
    NotificationSubscription: notificationSubscriptionModel(connection),
    MailTemplate: mailTemplateModel(connection),
    MailDelivery: mailDeliveryModel(connection),
    NewsletterSubscription: newsletterSubscriptionModel(connection),
    ContactMessage: contactMessageModel(connection),
    Shipment: shipmentModel(connection),
    OrderReturn: orderReturnModel(connection),
    SerialNumber: serialNumberModel(connection),
    PushSubscription: pushSubscriptionModel(connection),
    Job: jobModel(connection),
    Task: taskModel(connection),
    Payable: payableModel(connection),
    StaffProfile: staffProfileModel(connection),
    Attendance: attendanceModel(connection),
    SalaryConfig: salaryConfigModel(connection),
    Payroll: payrollModel(connection),
    Stocktake: stocktakeModel(connection),
    ShiftTemplate: shiftTemplateModel(connection),
    ShiftAssignment: shiftAssignmentModel(connection),
  }
}

/**
 * Idempotent preparation of one customer connection: pending migrations, then
 * model registration. A failed preparation is not cached, so the next request
 * retries instead of serving with half-registered models.
 */
export async function prepareDatabase(connection: Connection, now: Date = new Date()): Promise<PreparedModels> {
  const cached = preparation.get(connection)
  if (cached) return cached

  const pending = prepare(connection, now)
  preparation.set(connection, pending)

  try {
    return await pending
  } catch (error) {
    preparation.delete(connection)
    throw error
  }
}

/**
 * Single entry point for a business endpoint: verified context → tenant-bound
 * connection → prepared models. Endpoints do not open connections themselves.
 */
export async function withPreparedDb<T>(
  event: H3Event,
  handler: (context: PreparedModels & { connection: Connection }) => Promise<T>,
): Promise<T> {
  return withCustomerDb(event, async (connection) => {
    const models = await prepareDatabase(connection)
    return handler({ connection, ...models })
  })
}
