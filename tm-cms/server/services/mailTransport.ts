/**
 * The provider boundary for outbound mail.
 *
 * Nothing in this repository sends mail by itself: a delivery is stored and
 * `resolveMailTransport` decides whether a provider is configured. With no
 * provider the queue keeps the message and says so, which is honest — legacy
 * claimed a send and stored nothing, so a failed contact form was invisible.
 *
 * A real provider (Resend, SES, Postmark) is an adapter behind this interface and
 * its credentials belong in the deployment's secret store, never in Mongo and
 * never in a settings document. That is the `Connect.credentials` defect from
 * the legacy analysis.
 */

export interface MailMessage {
  deliveryId: string
  to: string
  subject: string
  text: string
  html: string | null
  purpose: string
}

export interface MailTransport {
  name: string
  send(message: MailMessage): Promise<{ providerId: string }>
}

export class MailTransportError extends Error {
  code: string
  retryable: boolean
  constructor(code: string, message: string, options: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'MailTransportError'
    this.code = code
    this.retryable = options.retryable ?? true
  }
}

/** Logs the fact of a send, never the body: a delivery can carry personal data. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const head = local.slice(0, 1)
  return `${head}${'*'.repeat(Math.max(local.length - 1, 0))}@${domain}`
}

const consoleTransport: MailTransport = {
  name: 'console',
  async send(message) {
    console.info(`[mail] ${message.deliveryId} → ${maskEmail(message.to)} (${message.purpose})`)
    return { providerId: `console:${message.deliveryId}` }
  },
}

/**
 * `TM_MAIL_PROVIDER=console` is the only built-in adapter. Anything else is
 * treated as "not configured" rather than silently falling back to a fake send,
 * so an operator sees queued deliveries instead of believing mail went out.
 */
export function resolveMailTransport(env: Record<string, string | undefined> = process.env): MailTransport | null {
  const provider = (env.TM_MAIL_PROVIDER || '').trim().toLowerCase()
  if (provider === 'console') return consoleTransport
  return null
}
