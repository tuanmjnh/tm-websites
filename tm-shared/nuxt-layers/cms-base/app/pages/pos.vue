<script setup lang="ts">
import type { AdminOrder } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { createOrder, listItemOptions } = useOperationsAdmin()

const canWrite = computed(() => hasCapability('content.write'))

const query = ref('')
const results = ref<{ id: string, sku: string, title: Record<string, string>, basePrice: number, salePrice: number | null, stock: number }[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const cart = ref<{ itemId: string, sku: string, name: string, price: number, quantity: number }[]>([])

const customerName = ref('')
const customerPhone = ref('')
const paymentMethod = ref('cash')
const discountAmount = ref(0)
const shippingFee = ref(0)
const submitting = ref(false)
const lastOrderCode = ref<string | null>(null)

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} ₫`
const lineTotal = (line: { price: number, quantity: number }) => line.price * line.quantity
const itemsPrice = computed(() => cart.value.reduce((s, l) => s + l.price * l.quantity, 0))
const totalAmount = computed(() => Math.max(0, itemsPrice.value + shippingFee.value - discountAmount.value))

const searchProducts = async () => {
  if (!query.value.trim()) { results.value = []; return }
  searching.value = true
  try {
    results.value = await listItemOptions(query.value.trim(), 20)
  } catch {
    results.value = []
  } finally {
    searching.value = false
  }
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void searchProducts() }, 300)
})

const addToCart = (item: { id: string, sku: string, title: Record<string, string>, basePrice: number, salePrice: number | null }) => {
  const price = item.salePrice ?? item.basePrice ?? 0
  const name = item.title?.vi || item.title?.en || item.sku
  const existing = cart.value.find(l => l.itemId === item.id)
  if (existing) existing.quantity += 1
  else cart.value.push({ itemId: item.id, sku: item.sku, name, price, quantity: 1 })
  query.value = ''
  results.value = []
}

const removeLine = (index: number) => { cart.value.splice(index, 1) }

const submitOrder = async () => {
  if (!canWrite.value || submitting.value || !cart.value.length) return
  submitting.value = true
  lastOrderCode.value = null
  try {
    const body = {
      channel: 'pos',
      status: 'completed',
      paymentMethod: paymentMethod.value,
      paymentStatus: 'paid',
      paidAmount: totalAmount.value,
      currency: 'VND',
      shippingFee: shippingFee.value,
      discountAmount: discountAmount.value,
      shippingAddress: { fullName: customerName.value || 'Khách lẻ', phone: customerPhone.value, street: '', ward: '', district: '', city: '', country: 'Vietnam' },
      items: cart.value.map(l => ({ itemId: l.itemId, itemName: l.name, sku: l.sku, price: l.price, quantity: l.quantity, attributes: {} })),
      note: 'POS',
    }
    const order = await createOrder(body)
    lastOrderCode.value = (order as AdminOrder).code
    toast.add({ title: t('admin.pos.created', { code: lastOrderCode.value }), color: 'success' })
    cart.value = []
    customerName.value = ''
    customerPhone.value = ''
    discountAmount.value = 0
    shippingFee.value = 0
  } catch {
    toast.add({ title: t('admin.pos.createFailed'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <div class="lg:col-span-2 space-y-3">
      <div class="relative">
        <UInput v-model="query" icon="i-lucide-search" :placeholder="t('admin.pos.searchPlaceholder')" class="w-full" :loading="searching" />
        <div v-if="results.length" class="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-default bg-default shadow">
          <button
            v-for="item in results"
            :key="item.id"
            type="button"
            class="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-elevated/40"
            @click="addToCart(item)"
          >
            <span class="font-medium text-highlighted">{{ item.title?.vi || item.title?.en || item.sku }}</span>
            <span class="text-xs text-muted">{{ item.sku }} · {{ money(item.salePrice ?? item.basePrice ?? 0) }}</span>
          </button>
        </div>
      </div>

      <div class="overflow-hidden rounded-md border border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/40 text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('admin.pos.item') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('admin.pos.price') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('admin.pos.qty') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('admin.pos.amount') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-default/60">
            <tr v-for="(line, index) in cart" :key="index">
              <td class="px-3 py-2">
                <p class="font-medium text-highlighted">{{ line.name }}</p>
                <p class="text-xs text-muted">{{ line.sku }}</p>
              </td>
              <td class="px-3 py-2 text-right">{{ money(line.price) }}</td>
              <td class="px-3 py-2 text-right">
                <UInput v-model.number="line.quantity" type="number" min="1" size="xs" class="w-16" />
              </td>
              <td class="px-3 py-2 text-right font-medium">{{ money(lineTotal(line)) }}</td>
              <td class="px-3 py-2 text-right">
                <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="removeLine(index)" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!cart.length" class="p-6 text-center text-sm text-muted">{{ t('admin.pos.emptyCart') }}</p>
      </div>
    </div>

    <div class="space-y-3">
      <div class="rounded-md border border-default p-4 space-y-3">
        <UFormField :label="t('admin.pos.customerName')"><UInput v-model="customerName" class="w-full" /></UFormField>
        <UFormField :label="t('admin.pos.customerPhone')"><UInput v-model="customerPhone" class="w-full" /></UFormField>
        <UFormField :label="t('admin.pos.paymentMethod')">
          <USelect v-model="paymentMethod" :items="[
            { label: t('admin.orders.paymentMethods.cash'), value: 'cash' },
            { label: t('admin.orders.paymentMethods.banking'), value: 'banking' },
            { label: t('admin.orders.paymentMethods.card'), value: 'card' },
            { label: t('admin.orders.paymentMethods.other'), value: 'other' },
          ]" value-key="value" class="w-full" />
        </UFormField>
        <UFormField :label="t('admin.pos.discount')"><UInput v-model.number="discountAmount" type="number" min="0" class="w-full" /></UFormField>
        <UFormField :label="t('admin.pos.shipping')"><UInput v-model.number="shippingFee" type="number" min="0" class="w-full" /></UFormField>

        <div class="border-t border-default pt-2 space-y-1 text-sm">
          <div class="flex justify-between"><span class="text-muted">{{ t('admin.pos.subtotal') }}</span><span>{{ money(itemsPrice) }}</span></div>
          <div class="flex justify-between font-semibold"><span>{{ t('admin.pos.total') }}</span><span>{{ money(totalAmount) }}</span></div>
        </div>

        <UButton
          color="primary"
          size="lg"
          block
          :loading="submitting"
          :disabled="!canWrite || !cart.length"
          :label="t('admin.pos.checkout')"
          @click="submitOrder"
        />

        <p v-if="lastOrderCode" class="text-xs text-success">{{ t('admin.pos.lastOrder') }}: {{ lastOrderCode }}</p>
      </div>
    </div>
  </div>
</template>