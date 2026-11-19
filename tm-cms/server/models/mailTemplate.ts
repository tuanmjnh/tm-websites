import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Local mail templates (MSG-02).
 *
 * Legacy kept mail templates in Hub settings and interpolated request input
 * straight into the HTML, which is how a contact form could inject markup into a
 * message the shop sent. Here the template declares the variables it needs, the
 * renderer escapes every substituted value for HTML, and a body is plain text
 * unless an explicit HTML variant is stored.
 */

export const MAIL_TEMPLATE_SCHEMA_VERSION = 1

const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/
const VARIABLE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/

export const MAIL_TEMPLATE_STATUSES = ['draft', 'active', 'archived'] as const
export type MailTemplateStatus = (typeof MAIL_TEMPLATE_STATUSES)[number]

export const MAIL_PURPOSES = ['transactional', 'marketing'] as const
export type MailPurpose = (typeof MAIL_PURPOSES)[number]

export class MailTemplateInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MailTemplateInvariantError'
    this.code = code
  }
}

export const MailTemplateDraftSchema = z.object({
  siteId: z.string().min(1).max(64),
  code: z.string().regex(CODE_PATTERN),
  locale: z.string().regex(LOCALE_PATTERN).default('vi'),
  title: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  bodyText: z.string().max(20000).default(''),
  bodyHtml: z.string().max(50000).default(''),
  /** Every variable the renderer must receive before a message is queued. */
  variables: z.array(z.string().regex(VARIABLE_PATTERN)).max(30).default([]),
  purpose: z.enum(MAIL_PURPOSES).default('transactional'),
  status: z.enum(MAIL_TEMPLATE_STATUSES).default('draft'),
})

export type MailTemplateDraft = z.infer<typeof MailTemplateDraftSchema>

export interface MailTemplateDocument {
  siteId: string
  code: string
  locale: string
  title: string
  subject: string
  bodyText: string
  bodyHtml: string
  variables: string[]
  purpose: MailPurpose
  status: MailTemplateStatus
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function uniqueVariables(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const cleaned = list
    .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(entry => entry.length > 0)
  return [...new Set(cleaned)]
}

export function normalizeMailTemplateInput(input: unknown): MailTemplateDraft {
  const source = readRecord(input)
  try {
    return MailTemplateDraftSchema.parse({
      ...source,
      variables: uniqueVariables(source.variables),
      // A template with no body at all would queue empty mail; one of the two
      // representations has to carry the message.
      bodyText: typeof source.bodyText === 'string' ? source.bodyText : '',
      bodyHtml: typeof source.bodyHtml === 'string' ? source.bodyHtml : '',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new MailTemplateInvariantError('MAIL_TEMPLATE_PAYLOAD_INVALID', 'Mail template payload is invalid')
    }
    throw error
  }
}

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

/** Names a template actually references, in first-seen order. */
export function templateVariables(...texts: string[]): string[] {
  const found: string[] = []
  for (const text of texts) {
    for (const match of text.matchAll(TOKEN)) {
      const name = match[1]!
      if (!found.includes(name)) found.push(name)
    }
  }
  return found
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * One substitution pass, no loops, no expressions: `{{name}}` becomes the value
 * and nothing else is interpreted. `escape` is on for HTML bodies, which is the
 * whole difference from legacy interpolating request input straight into markup.
 */
export function renderMailText(template: string, variables: Record<string, string>, options: { escape: boolean }): string {
  return template.replace(TOKEN, (_match, name: string) => {
    const value = variables[name] ?? ''
    return options.escape ? escapeHtml(value) : value
  })
}

/**
 * A template whose bodies are both empty cannot send anything useful, and one
 * that references a variable it never declares fails at queue time with a
 * confusing error. Both are refused when the template is written.
 */
export function assertMailTemplateUsable(draft: MailTemplateDraft): void {
  if (!draft.bodyText.trim() && !draft.bodyHtml.trim()) {
    throw new MailTemplateInvariantError('MAIL_TEMPLATE_BODY_REQUIRED', 'A mail template needs a text or HTML body')
  }

  const referenced = templateVariables(draft.subject, draft.bodyText, draft.bodyHtml)
  const undeclared = referenced.filter(name => !draft.variables.includes(name))
  if (undeclared.length > 0) {
    throw new MailTemplateInvariantError(
      'MAIL_TEMPLATE_VARIABLE_UNDECLARED',
      `Template references undeclared variables: ${undeclared.join(', ')}`,
    )
  }
}

const MailTemplateMongooseSchema = new Schema<MailTemplateDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    locale: { type: String, required: true, default: 'vi' },
    title: { type: String, required: true },
    subject: { type: String, required: true },
    bodyText: { type: String, default: '' },
    bodyHtml: { type: String, default: '' },
    variables: { type: [String], default: [] },
    purpose: { type: String, enum: MAIL_PURPOSES, default: 'transactional' },
    status: { type: String, enum: MAIL_TEMPLATE_STATUSES, default: 'draft' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: MAIL_TEMPLATE_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_mail_templates',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

MailTemplateMongooseSchema.index({ siteId: 1, code: 1, locale: 1 }, { unique: true, name: 'mail_template_site_code_locale' })
MailTemplateMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'mail_template_site_status' })

export function mailTemplateModel(connection: Connection): Model<MailTemplateDocument> {
  const registered = connection.models.MailTemplate as Model<MailTemplateDocument> | undefined
  if (registered) return registered
  return connection.model<MailTemplateDocument>('MailTemplate', MailTemplateMongooseSchema, 'crm_mail_templates')
}

export async function syncMailTemplateIndexes(connection: Connection): Promise<void> {
  await mailTemplateModel(connection).createIndexes()
}
