<script setup lang="ts">
import { PublicContactMessageSchema } from '@tm/flow-contracts'

const { t } = useI18n()
const { brandName, contactEmail, contactPhone, contactAddress } = usePublicSite()
const { socialLinks } = useSiteConfig()

/**
 * The contact channels are the ones the customer saved in site settings; the
 * storefront never invents a phone number or an address, so a site that has
 * saved none gets an explicit notice instead of a form that goes nowhere.
 */
const channels = computed(() => [
  contactEmail.value && { icon: 'i-lucide-mail', label: t('contact.email'), value: contactEmail.value, href: `mailto:${contactEmail.value}` },
  contactPhone.value && { icon: 'i-lucide-phone', label: t('contact.phone'), value: contactPhone.value, href: `tel:${contactPhone.value.replace(/\s+/g, '')}` },
  contactAddress.value && { icon: 'i-lucide-map-pin', label: t('contact.address'), value: contactAddress.value, href: undefined },
].filter(Boolean) as Array<{ icon: string, label: string, value: string, href?: string }>)

/**
 * Message form.
 *
 * The message is stored for the storefront operator to answer; nothing is sent
 * from the request, so the form does not promise an email reply it cannot
 * deliver. `form.website` is a honeypot the server ignores when filled.
 */
const form = reactive({ name: '', email: '', phone: '', subject: '', message: '', website: '' })
const sending = ref(false)
const sent = ref(false)
const failed = ref(false)
const fieldErrors = ref<Record<string, string>>({})

const submitMessage = async () => {
  if (sending.value) return

  fieldErrors.value = {}
  failed.value = false

  const parsed = PublicContactMessageSchema.safeParse(form)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[issue.path.length - 1] ?? '')
      if (field && !errors[field]) errors[field] = t('contact.form.invalidField')
    }
    fieldErrors.value = errors
    return
  }

  sending.value = true
  try {
    await $fetch('/api/public/contact-message', { method: 'POST', body: parsed.data })
    sent.value = true
    Object.assign(form, { name: '', email: '', phone: '', subject: '', message: '' })
  } catch {
    failed.value = true
  } finally {
    sending.value = false
  }
}

const robots = usePageRobots({ empty: () => !channels.value.length && !socialLinks.value.length })

useSeoMeta({
  title: () => t('contact.title', { company: brandName.value }),
  description: () => t('contact.subtitle', { company: brandName.value }),
  ogTitle: () => t('contact.title', { company: brandName.value }),
  ogDescription: () => t('contact.subtitle', { company: brandName.value }),
  ogType: 'website',
  robots,
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('contact.title', { company: brandName }) }}
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-muted">
        {{ t('contact.subtitle', { company: brandName }) }}
      </p>
    </header>

    <section v-if="channels.length" class="panel border-default p-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('contact.channels') }}
      </h2>
      <dl class="mt-4 space-y-3">
        <div v-for="channel in channels" :key="channel.label" class="flex items-start gap-3">
          <UIcon :name="channel.icon" class="mt-0.5 size-4 text-primary" aria-hidden="true" />
          <div>
            <dt class="text-xs uppercase tracking-wide text-dimmed">
              {{ channel.label }}
            </dt>
            <dd class="text-sm text-highlighted">
              <a v-if="channel.href" :href="channel.href" class="hover:text-primary">{{ channel.value }}</a>
              <span v-else>{{ channel.value }}</span>
            </dd>
          </div>
        </div>
      </dl>
    </section>

    <WebNotice
      v-else
      icon="i-lucide-mail-question-mark"
      :title="t('contact.emptyTitle')"
      :description="t('contact.emptyHint')"
    />

    <section class="panel mt-6 border-default p-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('contact.form.title') }}
      </h2>

      <div v-if="sent" class="mt-3" role="status">
        <p class="text-sm font-medium text-highlighted">{{ t('contact.form.sentTitle') }}</p>
        <p class="mt-1 text-sm text-muted">{{ t('contact.form.sentHint') }}</p>
        <UButton color="neutral" variant="soft" size="sm" class="mt-3" :label="t('contact.form.sendAnother')" @click="sent = false" />
      </div>

      <form v-else class="mt-3 space-y-4" @submit.prevent="submitMessage">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="contact-name" class="mb-1 block text-xs font-medium text-muted">{{ t('contact.form.name') }}</label>
            <UInput id="contact-name" v-model="form.name" autocomplete="name" :disabled="sending" class="w-full" />
            <p v-if="fieldErrors.name" class="mt-1 text-xs text-error">{{ fieldErrors.name }}</p>
          </div>
          <div>
            <label for="contact-email" class="mb-1 block text-xs font-medium text-muted">{{ t('contact.form.email') }}</label>
            <UInput id="contact-email" v-model="form.email" type="email" autocomplete="email" :disabled="sending" class="w-full" />
            <p v-if="fieldErrors.email" class="mt-1 text-xs text-error">{{ fieldErrors.email }}</p>
          </div>
          <div>
            <label for="contact-phone" class="mb-1 block text-xs font-medium text-muted">{{ t('contact.form.phone') }}</label>
            <UInput id="contact-phone" v-model="form.phone" type="tel" autocomplete="tel" :disabled="sending" class="w-full" />
          </div>
          <div>
            <label for="contact-subject" class="mb-1 block text-xs font-medium text-muted">{{ t('contact.form.subject') }}</label>
            <UInput id="contact-subject" v-model="form.subject" :disabled="sending" class="w-full" />
          </div>
        </div>
        <div>
          <label for="contact-message" class="mb-1 block text-xs font-medium text-muted">{{ t('contact.form.message') }}</label>
          <UTextarea id="contact-message" v-model="form.message" :rows="5" :disabled="sending" class="w-full" />
          <p v-if="fieldErrors.message" class="mt-1 text-xs text-error">{{ fieldErrors.message }}</p>
        </div>

        <div class="sr-only" aria-hidden="true">
          <label for="contact-website">Website</label>
          <input id="contact-website" v-model="form.website" type="text" tabindex="-1" autocomplete="off">
        </div>

        <div v-if="failed" class="rounded-[6px] border border-error/50 bg-error/10 px-4 py-3" role="alert">
          <p class="text-sm text-error">{{ t('contact.form.failed') }}</p>
        </div>

        <UButton
          type="submit"
          color="primary"
          size="md"
          :loading="sending"
          :label="sending ? t('contact.form.sending') : t('contact.form.submit')"
        />
      </form>
    </section>

    <section v-if="socialLinks.length" class="mt-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('contact.social') }}
      </h2>
      <ul class="mt-3 flex flex-wrap gap-2">
        <li v-for="[network, url] in socialLinks" :key="network">
          <a
            :href="url"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="inline-flex items-center gap-1 rounded-[4px] bg-muted px-3 py-1.5 text-xs font-medium text-muted hover:text-primary"
          >
            {{ network }}
            <UIcon name="i-lucide-external-link" class="size-3" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
