import assert from 'node:assert/strict'
import {
  NewsletterSubscribeRequestSchema,
  NewsletterSubscribeResponseSchema,
  NewsletterTokenRequestSchema,
  NewsletterConfirmResponseSchema,
  NewsletterUnsubscribeResponseSchema,
  NewsletterResendRequestSchema,
  NewsletterResendResponseSchema,
  normalizeNewsletterEmail,
  newsletterRecipientName,
  NEWSLETTER_NEUTRAL_NAME,
} from '../../tm-shared/packages/flow-contracts/src/public-newsletter.js'
import {
  renderMailText,
  templateVariables,
} from '../../tm-web/server/utils/mailRender.js'

let checks = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

console.log('Newsletter — double opt-in contract and mail rendering\n')

await check('an email is normalized to lowercase without whitespace', async () => {
  assert.equal(normalizeNewsletterEmail('  A@Example.COM '), 'a@example.com')
})

await check('a signup requires consent', async () => {
  assert.equal(NewsletterSubscribeRequestSchema.safeParse({ email: 'a@example.com', consent: true }).success, true)
  assert.equal(NewsletterSubscribeRequestSchema.safeParse({ email: 'a@example.com', consent: false }).success, false)
  assert.equal(NewsletterSubscribeRequestSchema.safeParse({ email: 'a@example.com' }).success, false)
})

await check('an invalid email is rejected', async () => {
  assert.equal(NewsletterSubscribeRequestSchema.safeParse({ email: 'nope', consent: true }).success, false)
})

await check('the response states what happened instead of promising a mail', async () => {
  for (const state of ['pending_confirmation', 'already_confirmed', 'confirmation_not_queued']) {
    assert.equal(NewsletterSubscribeResponseSchema.safeParse({ success: true, data: { state } }).success, true)
  }
  assert.equal(NewsletterSubscribeResponseSchema.safeParse({ success: true, data: { state: 'sent' } }).success, false)
})

await check('a missing name falls back to a neutral greeting, never the address', async () => {
  assert.equal(newsletterRecipientName(''), NEWSLETTER_NEUTRAL_NAME)
  assert.equal(newsletterRecipientName('   '), NEWSLETTER_NEUTRAL_NAME)
  assert.equal(newsletterRecipientName(' An '), 'An')
  assert.ok(!newsletterRecipientName('').includes('@'))
})

await check('a token shorter than 16 characters is rejected', async () => {
  assert.equal(NewsletterTokenRequestSchema.safeParse({ token: 'short' }).success, false)
  assert.equal(NewsletterTokenRequestSchema.safeParse({ token: 'a'.repeat(36) }).success, true)
})

await check('confirmation returns the confirmed status', async () => {
  const parsed = NewsletterConfirmResponseSchema.parse({ success: true, data: { status: 'confirmed' } })
  assert.equal(parsed.data.status, 'confirmed')
})

await check('opting out answers the unsubscribed status', async () => {
  const parsed = NewsletterUnsubscribeResponseSchema.parse({ success: true, data: { status: 'unsubscribed' } })
  assert.equal(parsed.data.status, 'unsubscribed')
  assert.equal(NewsletterUnsubscribeResponseSchema.safeParse({ success: true, data: { status: 'confirmed' } }).success, false)
})

await check('asking for the mail again takes only a normalised address', async () => {
  const parsed = NewsletterResendRequestSchema.parse({ email: '  Again@Example.COM ' })
  assert.equal(parsed.email, 'again@example.com')
  assert.equal(NewsletterResendRequestSchema.safeParse({ email: 'nope' }).success, false)
  assert.equal(NewsletterResendRequestSchema.safeParse({}).success, false)
})

await check('a resend answers one neutral state, never whether the address is on the list', async () => {
  assert.equal(NewsletterResendResponseSchema.safeParse({ success: true, data: { state: 'accepted' } }).success, true)
  for (const leaky of ['sent', 'not_pending', 'cooldown', 'already_confirmed']) {
    assert.equal(NewsletterResendResponseSchema.safeParse({ success: true, data: { state: leaky } }).success, false)
  }
})

await check('the same link token shape carries the unsubscribe link', async () => {
  assert.equal(NewsletterTokenRequestSchema.safeParse({ token: 'b'.repeat(36) }).success, true)
  assert.equal(
    renderMailText('Huỷ đăng ký: {{ unsubscribeUrl }}', { unsubscribeUrl: 'https://shop.example/newsletter/huy-dang-ky?token=t' }, { escape: false }),
    'Huỷ đăng ký: https://shop.example/newsletter/huy-dang-ky?token=t',
  )
})

await check('template tokens render raw in text and escaped in HTML', async () => {
  const variables = { name: 'A <b>', confirmUrl: 'https://shop.example/newsletter/xac-nhan?token=t' }
  assert.equal(renderMailText('Xin chào {{ name }}', variables, { escape: false }), 'Xin chào A <b>')
  assert.equal(
    renderMailText('<p>Xin chào {{name}}</p>', variables, { escape: true }),
    '<p>Xin chào A &lt;b&gt;</p>',
  )
  assert.equal(
    renderMailText('{{ confirmUrl }}', variables, { escape: false }),
    'https://shop.example/newsletter/xac-nhan?token=t',
  )
})

await check('an unknown variable renders empty instead of leaking the token', async () => {
  assert.equal(renderMailText('[{{ missing }}]', {}, { escape: false }), '[]')
})

await check('referenced variables are listed once each', async () => {
  assert.deepEqual(
    templateVariables('{{ email }} {{name}} {{ email }}', '{{ confirmUrl }}'),
    ['email', 'name', 'confirmUrl'],
  )
})

console.log(`\n${process.exitCode ? '❌' : '✅'} Newsletter checks: ${checks} passed\n`)
