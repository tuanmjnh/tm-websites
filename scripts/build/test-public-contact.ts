import assert from 'node:assert/strict'
import {
  PublicContactMessageSchema,
  PublicContactResponseSchema,
} from '../../tm-shared/packages/flow-contracts/src/public-contact.js'

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

const MESSAGE = {
  name: 'Nguyễn Văn A',
  email: 'A@Example.COM',
  message: 'Tôi muốn hỏi về thời gian giao hàng.',
}

console.log('Public contact — contact form contract\n')

await check('a minimal message parses with empty optional fields', async () => {
  const parsed = PublicContactMessageSchema.parse(MESSAGE)
  assert.equal(parsed.email, 'a@example.com')
  assert.equal(parsed.phone, '')
  assert.equal(parsed.subject, '')
  assert.equal(parsed.website, '')
})

await check('the honeypot parses when a bot fills it', async () => {
  const parsed = PublicContactMessageSchema.parse({ ...MESSAGE, website: 'https://spam.example' })
  assert.equal(parsed.website, 'https://spam.example')
})

await check('a name, email or message is required', async () => {
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, name: '' }).success, false)
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, email: 'nope' }).success, false)
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, message: '' }).success, false)
})

await check('a too-short message or an over-long field is rejected', async () => {
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, message: 'hi' }).success, false)
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, message: 'x'.repeat(5001) }).success, false)
  assert.equal(PublicContactMessageSchema.safeParse({ ...MESSAGE, name: 'x'.repeat(121) }).success, false)
})

await check('the response confirms receipt without exposing an id', async () => {
  const parsed = PublicContactResponseSchema.parse({ success: true, data: { received: true } })
  assert.deepEqual(Object.keys(parsed.data), ['received'])
})

console.log(`\n${process.exitCode ? '❌' : '✅'} Public contact checks: ${checks} passed\n`)
