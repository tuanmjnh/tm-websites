<script setup lang="ts">
import { z } from 'zod'

definePageMeta({
  layout: false,
})

const { t, te } = useI18n()
const { customer } = useCustomerConfig()
const { login, loading, loginError, totpRequired, verifyTotp, cancelTotp } = useHub()

const state = reactive({
  email: '',
  password: '',
})

const totpState = reactive({
  code: '',
})

const errorMessage = computed(() => {
  if (!loginError.value || loginError.value === 'TOTP_REQUIRED') return ''
  const key = `auth.errors.${loginError.value}`
  return te(key) ? t(key) : t('auth.loginFailed')
})

const credentialsSchema = computed(() => z.object({
  email: z.string().min(1, t('auth.emailRequired')).email(t('auth.emailInvalid')),
  password: z.string().min(6, t('auth.passwordMin')),
}))

const totpSchema = computed(() => z.object({
  code: z.string().trim().min(6, t('auth.totp.codeRequired')).max(32, t('auth.totp.codeInvalid')),
}))

async function onSubmit() {
  const success = await login(state)
  if (!success) {
    return
  }
  await navigateTo('/')
}

async function onSubmitTotp() {
  const success = await verifyTotp(totpState.code.trim())
  if (!success) {
    return
  }
  await navigateTo('/')
}

function onBackToCredentials() {
  totpState.code = ''
  cancelTotp()
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
    <div class="udmt-backdrop" />

    <div class="panel relative z-10 w-full max-w-md p-8">
      <div class="flex flex-col items-center text-center">
        <img
          src="/branding/logo.svg"
          :alt="customer?.companyName || 'TM CMS'"
          class="size-12"
          width="48"
          height="48"
        >
        <h1 class="mt-4 text-lg font-semibold text-highlighted">
          {{ customer?.companyName || 'TM CMS' }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          {{ totpRequired ? t('auth.totp.description') : t('auth.loginDescription') }}
        </p>
      </div>

      <UForm
        v-if="!totpRequired"
        :schema="credentialsSchema"
        :state="state"
        class="mt-6 flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField :label="t('auth.email')" name="email">
          <UInput
            v-model="state.email"
            type="email"
            autocomplete="username"
            icon="i-lucide-mail"
            :placeholder="t('auth.emailPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('auth.password')" name="password">
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="current-password"
            icon="i-lucide-lock"
            :placeholder="t('auth.passwordPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
        />

        <UButton
          type="submit"
          color="primary"
          variant="soft"
          size="md"
          block
          icon="i-lucide-log-in"
          :loading="loading"
          :label="loading ? t('auth.submitting') : t('auth.submit')"
        />
      </UForm>

      <UForm
        v-else
        :schema="totpSchema"
        :state="totpState"
        class="mt-6 flex flex-col gap-4"
        @submit="onSubmitTotp"
      >
        <UFormField :label="t('auth.totp.code')" name="code">
          <UInput
            v-model="totpState.code"
            autocomplete="one-time-code"
            icon="i-lucide-shield-check"
            :placeholder="t('auth.totp.codePlaceholder')"
            class="w-full"
          />
        </UFormField>

        <p class="text-xs text-muted">
          {{ t('auth.totp.recoveryHint') }}
        </p>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
        />

        <UButton
          type="submit"
          color="primary"
          variant="soft"
          size="md"
          block
          icon="i-lucide-shield-check"
          :loading="loading"
          :label="loading ? t('auth.totp.submitting') : t('auth.totp.submit')"
        />

        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="md"
          block
          icon="i-lucide-arrow-left"
          :label="t('auth.totp.back')"
          :disabled="loading"
          @click="onBackToCredentials"
        />
      </UForm>

      <p class="mt-6 flex items-center justify-center gap-1.5 text-xs text-dimmed">
        <UIcon name="i-lucide-shield-check" class="size-3.5" />
        <span>{{ t('auth.securedBy') }}</span>
      </p>
    </div>
  </div>
</template>
