import {
  PUBLIC_CART_MAX_LINES,
  PUBLIC_CART_MAX_QUANTITY,
  cartLineKey,
  type PublicCart,
  type PublicCartApiResponse,
  type PublicCartIssue,
  type PublicCartLineInput,
} from '@tm/flow-contracts'

/**
 * Client-owned cart.
 *
 * localStorage only ever holds ids, variant SKUs, quantities and the price the
 * visitor was shown. The displayed cart, subtotal and availability come from
 * `POST /api/public/cart/validate`, so editing storage cannot change the
 * quoted total. A line whose quoted price moved is flagged once, then its stored
 * expected price is synced so the notice does not nag on every reload.
 */
export interface CartStoredLine {
  itemId: string
  variantSku?: string
  quantity: number
  expectedPrice?: number
}

export interface CartAddInput {
  itemId: string
  variantSku?: string
  expectedPrice?: number
}

const STORAGE_PREFIX = 'tm-cart:v1:'

const clampQuantity = (value: unknown): number => {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(PUBLIC_CART_MAX_QUANTITY, Math.max(1, parsed))
}

const sanitizeStoredLines = (raw: unknown): CartStoredLine[] => {
  if (!Array.isArray(raw)) return []

  const lines: CartStoredLine[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const itemId = typeof record.itemId === 'string' ? record.itemId.trim() : ''
    if (!itemId) continue

    const variantSku = typeof record.variantSku === 'string' && record.variantSku.trim()
      ? record.variantSku.trim()
      : undefined
    const line: CartStoredLine = { itemId, quantity: clampQuantity(record.quantity) }
    if (variantSku) line.variantSku = variantSku

    const price = Number(record.expectedPrice)
    if (Number.isFinite(price) && price >= 0) line.expectedPrice = price

    const key = cartLineKey(line)
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(line)
    if (lines.length >= PUBLIC_CART_MAX_LINES) break
  }

  return lines
}

export const useCart = () => {
  const config = useRuntimeConfig()

  const lines = useState<CartStoredLine[]>('cart:lines', () => [])
  const quoted = useState<PublicCart | null>('cart:quoted', () => null)
  const pending = useState<boolean>('cart:pending', () => false)
  const hydrated = useState<boolean>('cart:hydrated', () => false)

  const storageKey = computed(() => `${STORAGE_PREFIX}${String(config.public.siteUrl || 'default')}`)
  const count = computed(() => lines.value.reduce((total, line) => total + line.quantity, 0))
  const issues = computed<PublicCartIssue[]>(() => quoted.value?.issues ?? [])
  const subtotal = computed(() => quoted.value?.subtotal ?? 0)
  const currency = computed(() => quoted.value?.currency ?? String(config.public.currency || 'VND'))

  let requestSeq = 0

  const persist = () => {
    if (!import.meta.client) return
    try {
      localStorage.setItem(storageKey.value, JSON.stringify(lines.value))
    } catch {
      // Quota or a blocked storage area: the in-memory cart still works.
    }
  }

  const hydrate = () => {
    if (!import.meta.client || hydrated.value) return
    hydrated.value = true
    try {
      const raw = localStorage.getItem(storageKey.value)
      if (raw) lines.value = sanitizeStoredLines(JSON.parse(raw))
    } catch {
      lines.value = []
    }
  }

  const quote = async () => {
    hydrate()
    if (!lines.value.length) {
      quoted.value = null
      return
    }
    if (!import.meta.client) return

    const seq = ++requestSeq
    pending.value = true

    try {
      const payload: PublicCartLineInput[] = lines.value.map(line => ({
        itemId: line.itemId,
        ...(line.variantSku ? { variantSku: line.variantSku } : {}),
        quantity: line.quantity,
        ...(line.expectedPrice === undefined ? {} : { expectedPrice: line.expectedPrice }),
      }))

      const response = await $fetch<PublicCartApiResponse>('/api/public/cart/validate', {
        method: 'POST',
        body: { lines: payload },
      })

      if (seq !== requestSeq) return
      quoted.value = response.data

      // Adopt the authoritative price so a later reload does not repeat the
      // notice, while an unavailable line keeps its stored price untouched.
      const quotedById = new Map(response.data.lines.map(line => [cartLineKey(line), line]))
      let changed = false
      for (const line of lines.value) {
        const match = quotedById.get(cartLineKey(line))
        if (match && match.available && match.unitPrice !== line.expectedPrice) {
          line.expectedPrice = match.unitPrice
          changed = true
        }
      }
      if (changed) persist()
    } catch {
      if (seq === requestSeq) quoted.value = null
    } finally {
      if (seq === requestSeq) pending.value = false
    }
  }

  const add = (line: CartAddInput, quantity = 1) => {
    hydrate()
    const key = cartLineKey(line)
    const existing = lines.value.find(entry => cartLineKey(entry) === key)

    if (existing) {
      existing.quantity = clampQuantity(existing.quantity + quantity)
      if (line.expectedPrice !== undefined) existing.expectedPrice = line.expectedPrice
    } else {
      if (lines.value.length >= PUBLIC_CART_MAX_LINES) return false
      const next: CartStoredLine = { itemId: line.itemId, quantity: clampQuantity(quantity) }
      if (line.variantSku) next.variantSku = line.variantSku
      if (line.expectedPrice !== undefined) next.expectedPrice = line.expectedPrice
      lines.value = [...lines.value, next]
    }

    persist()
    void quote()
    return true
  }

  const setQuantity = (key: string, quantity: number) => {
    lines.value = lines.value.map(line =>
      cartLineKey(line) === key ? { ...line, quantity: clampQuantity(quantity) } : line)
    persist()
    void quote()
  }

  const remove = (key: string) => {
    lines.value = lines.value.filter(line => cartLineKey(line) !== key)
    persist()
    void quote()
  }

  const clear = () => {
    lines.value = []
    quoted.value = null
    persist()
  }

  return {
    lines,
    quoted,
    pending,
    hydrated,
    count,
    issues,
    subtotal,
    currency,
    storageKey,
    hydrate,
    quote,
    add,
    setQuantity,
    remove,
    clear,
    cartLineKey,
  }
}
