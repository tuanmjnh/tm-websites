import type { Model } from 'mongoose'
import type { MailDeliveryDocument } from '../models/mailDelivery'
import { isCalendarDate, localDayOf, localDayStartUtc, todayInCustomerTime } from '../utils/customerTime'

/**
 * Delivery analytics (MSG-02). Everything here is a read of `crm_mail_deliveries`,
 * so the numbers can never disagree with the queue that produced them: a row that
 * was queued, sent, failed or cancelled is counted once, in the period it was
 * created in, and the queue-health block looks at the live queue rather than a
 * cached snapshot.
 */

export class MailAnalyticsError extends Error {
  statusCode: number
  code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'MailAnalyticsError'
    this.statusCode = statusCode
    this.code = code
  }
}

export interface MailAnalytics {
  range: { from: string, to: string }
  totals: { all: number, queued: number, sending: number, sent: number, failed: number, cancelled: number }
  byTemplate: { templateCode: string, all: number, queued: number, sent: number, failed: number, cancelled: number }[]
  byDay: { day: string, queued: number, sent: number, failed: number }[]
  queueHealth: {
    dueNow: number
    sending: number
    oldestQueuedAt: string | null
    oldestQueuedAgeMinutes: number | null
  }
  failureReasons: { reason: string, count: number }[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DAYS = 30
const MAX_DAYS = 366

function emptyCounts() {
  return { all: 0, queued: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 }
}

export function resolveMailRange(from: unknown, to: unknown, now: Date = new Date()): { from: string, to: string, startUtc: Date, endUtc: Date } {
  const today = todayInCustomerTime(now)
  let resolvedFrom = typeof from === 'string' && from ? from : null
  let resolvedTo = typeof to === 'string' && to ? to : null

  if (!resolvedFrom && !resolvedTo) {
    const start = new Date(localDayStartUtc(today).getTime() - (DEFAULT_DAYS - 1) * DAY_MS)
    resolvedFrom = localDayOf(start)
    resolvedTo = today
  } else {
    if (!resolvedFrom) resolvedFrom = resolvedTo as string
    if (!resolvedTo) resolvedTo = resolvedFrom as string
  }

  if (!isCalendarDate(resolvedFrom) || !isCalendarDate(resolvedTo)) {
    throw new MailAnalyticsError(422, 'MAIL_RANGE_INVALID', 'Khoảng ngày không hợp lệ (YYYY-MM-DD)')
  }
  const startUtc = localDayStartUtc(resolvedFrom)
  const endUtc = new Date(localDayStartUtc(resolvedTo).getTime() + DAY_MS)
  const days = Math.round((endUtc.getTime() - startUtc.getTime()) / DAY_MS)
  if (days <= 0) throw new MailAnalyticsError(422, 'MAIL_RANGE_INVALID', 'Ngày bắt đầu phải trước ngày kết thúc')
  if (days > MAX_DAYS) throw new MailAnalyticsError(422, 'MAIL_RANGE_TOO_LONG', `Khoảng báo cáo tối đa ${MAX_DAYS} ngày`)
  return { from: resolvedFrom, to: resolvedTo, startUtc, endUtc }
}

export async function mailDeliveryAnalytics(
  model: Model<MailDeliveryDocument>,
  siteId: string,
  params: { from?: unknown, to?: unknown, now?: Date },
  now: Date = params.now ?? new Date(),
): Promise<MailAnalytics> {
  const range = resolveMailRange(params.from, params.to, now)

  const rows = await model.find({
    siteId,
    createdAt: { $gte: range.startUtc, $lt: range.endUtc },
  }).select({ templateCode: 1, status: 1, lastError: 1, createdAt: 1, sentAt: 1 }).lean<MailDeliveryDocument[]>()

  const totals = emptyCounts()
  const byTemplateMap = new Map<string, ReturnType<typeof emptyCounts>>()
  const byDayMap = new Map<string, { queued: number, sent: number, failed: number }>()

  for (const row of rows) {
    const status = row.status
    totals.all += 1
    if (status in totals) totals[status as keyof typeof totals] += 1

    const templateCode = row.templateCode
    if (!byTemplateMap.has(templateCode)) byTemplateMap.set(templateCode, emptyCounts())
    const templateCounts = byTemplateMap.get(templateCode)!
    templateCounts.all += 1
    if (status in templateCounts) templateCounts[status as keyof typeof templateCounts] += 1

    const day = localDayOf(new Date(row.createdAt))
    if (!byDayMap.has(day)) byDayMap.set(day, { queued: 0, sent: 0, failed: 0 })
    const dayCounts = byDayMap.get(day)!
    if (status === 'queued' || status === 'sending') dayCounts.queued += 1
    if (status === 'sent') dayCounts.sent += 1
    if (status === 'failed') dayCounts.failed += 1
  }

  const byTemplate = [...byTemplateMap.entries()]
    .map(([templateCode, counts]) => ({ templateCode, ...counts }))
    .sort((a, b) => b.all - a.all)

  const byDay = [...byDayMap.entries()]
    .map(([day, counts]) => ({ day, ...counts }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // Queue health reads the live queue, not the selected period.
  const queuedRows = await model.find({ siteId, status: 'queued' })
    .select({ nextAttemptAt: 1 })
    .lean<{ nextAttemptAt: Date }[]>()
  const sendingCount = await model.countDocuments({ siteId, status: 'sending' })
  const dueNow = queuedRows.filter(row => new Date(row.nextAttemptAt).getTime() <= now.getTime()).length
  const oldest = queuedRows.reduce<Date | null>((current, row) => {
    const candidate = new Date(row.nextAttemptAt)
    if (!current || candidate.getTime() < current.getTime()) return candidate
    return current
  }, null)

  const failureReasonsMap = new Map<string, number>()
  for (const row of rows) {
    if (row.status !== 'failed') continue
    const reason = (row.lastError ?? '').trim() || 'Không rõ nguyên nhân'
    failureReasonsMap.set(reason, (failureReasonsMap.get(reason) ?? 0) + 1)
  }
  const failureReasons = [...failureReasonsMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    range: { from: range.from, to: range.to },
    totals,
    byTemplate,
    byDay,
    queueHealth: {
      dueNow,
      sending: sendingCount,
      oldestQueuedAt: oldest ? oldest.toISOString() : null,
      oldestQueuedAgeMinutes: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 60_000)) : null,
    },
    failureReasons,
  }
}
