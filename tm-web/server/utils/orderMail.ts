import type { H3Event } from 'h3'
import { escapeRegExp } from '@tm/flow-utils'
import {
  ORDER_CONFIRMATION_TEMPLATE,
  orderConfirmationVariables,
  type OrderConfirmationMailInput,
} from '@tm/flow-contracts'
import { PublicMailDeliveryModel } from '#server/models/mailPublic'
import { queueStorefrontMail } from './mailQueue'
import { withSiteDb } from './mongo'

/**
 * Order confirmation, queued by the storefront itself.
 *
 * Checkout is the business event; the mail is a side effect of it. A missing
 * template, a missing address or a queue failure therefore never fails the
 * order — the caller only learns whether a message really reached the queue.
 */
export async function queueOrderConfirmation(
  event: H3Event,
  input: OrderConfirmationMailInput,
): Promise<boolean> {
  if (!input.email.trim()) return false

  const result = await queueStorefrontMail(event, {
    templateCode: ORDER_CONFIRMATION_TEMPLATE,
    to: input.email,
    variables: orderConfirmationVariables(input),
    // One message per order: a retried submit (same idempotency key) resolves to
    // the same order code, so the dedupe key keeps it from mailing twice.
    dedupeKey: `${ORDER_CONFIRMATION_TEMPLATE}:${input.orderCode}`,
  })

  return result.queued
}

/**
 * Whether this order already has a queued confirmation. A retried submit
 * returns the existing order without writing anything, so the truth has to be
 * read back from the queue rather than assembled again.
 */
export async function orderConfirmationQueued(
  event: H3Event,
  siteId: string,
  orderCode: string,
): Promise<boolean> {
  return withSiteDb(event, async () => {
    const count = await PublicMailDeliveryModel.countDocuments({
      siteId,
      templateCode: ORDER_CONFIRMATION_TEMPLATE,
      // `queueStorefrontMail` prefixes the recipient, so match the tail.
      dedupeKey: { $regex: `:${ORDER_CONFIRMATION_TEMPLATE}:${escapeRegExp(orderCode)}$` },
    })
    return count > 0
  })
}
