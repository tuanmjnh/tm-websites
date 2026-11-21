import type { H3Event } from 'h3'
import {
  ORDER_CONFIRMATION_TEMPLATE,
  orderConfirmationVariables,
  type OrderConfirmationMailInput,
} from '@tm/flow-contracts'
import { PublicMailDeliveryModel } from '#server/models/mailPublic'
import { queueStorefrontMail, storefrontDedupeKey } from './mailQueue'
import { withSiteDb } from './mongo'

/**
 * One message per order: a retried submit (same idempotency key) resolves to the
 * same order code, so the dedupe key keeps it from mailing twice.
 */
function orderConfirmationDedupeKey(orderCode: string): string {
  return `${ORDER_CONFIRMATION_TEMPLATE}:${orderCode}`
}

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
    dedupeKey: orderConfirmationDedupeKey(input.orderCode),
  })

  return result.queued
}

/**
 * Whether this order already has a queued confirmation. A retried submit
 * returns the existing order without writing anything, so the truth has to be
 * read back from the queue rather than assembled again.
 *
 * An address the retry no longer carries can only answer `false`: the page must
 * never promise a mail this request cannot account for.
 */
export async function orderConfirmationQueued(
  event: H3Event,
  siteId: string,
  orderCode: string,
  email: string,
): Promise<boolean> {
  if (!email.trim()) return false

  return withSiteDb(event, async () => {
    const delivery = await PublicMailDeliveryModel.exists({
      siteId,
      templateCode: ORDER_CONFIRMATION_TEMPLATE,
      dedupeKey: storefrontDedupeKey(email, orderConfirmationDedupeKey(orderCode)),
    })
    return Boolean(delivery)
  })
}
