import type { H3Event } from 'h3'
import { resolveSiteId } from './checkoutService'
import { PublicMailDeliveryModel, PublicMailTemplateModel } from '#server/models/mailPublic'
import { withSiteDb } from './mongo'
import { renderMailText } from './mailRender'

/**
 * Queue one transactional message from the storefront.
 *
 * The queued row is identical to what the CMS queue would write: the rendered
 * subject/body are snapshotted, the dedupe key is scoped to the recipient, and
 * the row starts `queued` for a provider to drain. A missing or unusable
 * template is reported to the caller instead of throwing, because a storefront
 * action (a signup, a checkout) must not fail over mail configuration.
 */

export interface StorefrontMailInput {
  templateCode: string
  to: string
  variables: Record<string, string>
  dedupeKey: string
}

export type StorefrontMailResult =
  | { queued: true }
  | { queued: false, reason: 'template_missing' | 'variables_missing' }

const DEFAULT_LOCALE = 'vi'

/**
 * The stored dedupe key is scoped to the recipient. Exported so a reader can
 * rebuild the exact key of a delivery it is looking for instead of matching it
 * with a pattern.
 */
export function storefrontDedupeKey(to: string, dedupeKey: string): string {
  return `${to.trim().toLowerCase()}:${dedupeKey}`.slice(0, 200)
}

export async function queueStorefrontMail(
  event: H3Event,
  input: StorefrontMailInput,
): Promise<StorefrontMailResult> {
  const siteId = resolveSiteId(event)
  // Templates are authored per locale in the CMS; storefront actions are sent
  // in the site's default locale because the visitor's language is not stored
  // on a signup or an order.
  const locale = DEFAULT_LOCALE

  return withSiteDb(event, async () => {
    const template = await PublicMailTemplateModel.findOne({
      siteId,
      code: input.templateCode,
      locale,
      status: 'active',
      isDeleted: { $ne: true },
    }).lean<Record<string, unknown> | null>()

    if (!template) return { queued: false, reason: 'template_missing' } as const

    const variables: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.variables)) variables[key] = String(value)

    const declared = Array.isArray(template.variables) ? template.variables.map(String) : []
    const missing = declared.filter(name => !variables[name]?.trim())
    if (missing.length) return { queued: false, reason: 'variables_missing' } as const

    const subject = renderMailText(String(template.subject ?? ''), variables, { escape: false }).slice(0, 300)
    const bodyText = renderMailText(String(template.bodyText ?? ''), variables, { escape: false })
    const bodyHtml = template.bodyHtml ? renderMailText(String(template.bodyHtml), variables, { escape: true }) : ''
    const now = new Date()
    const to = input.to.trim().toLowerCase()

    try {
      await PublicMailDeliveryModel.create({
        siteId,
        templateId: String(template._id),
        templateCode: String(template.code),
        purpose: String(template.purpose ?? 'transactional'),
        recipientEmail: to,
        recipientSubjectId: null,
        subject,
        bodyText,
        bodyHtml,
        variables,
        status: 'queued',
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        nextAttemptAt: now,
        providerId: null,
        dedupeKey: storefrontDedupeKey(to, input.dedupeKey),
        sentAt: null,
        cancelledAt: null,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      // A repeat of the same business event resolves to the delivery that exists.
      if ((error as { code?: number }).code !== 11000) throw error
    }

    return { queued: true } as const
  })
}
