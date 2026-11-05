import type { ComputedRef, Ref } from 'vue'

export interface HeaderActionChild {
  key?: string
  icon?: string
  label: string
  disabled?: boolean
  onSelect: () => unknown
}

export interface HeaderAction {
  key: string
  icon: string
  label: string
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  variant?: 'solid' | 'subtle' | 'outline' | 'soft' | 'ghost'
  primary?: boolean
  disabled?: boolean
  visible?: boolean
  overflow?: boolean
  children?: HeaderActionChild[]
  onSelect?: () => unknown
}

export interface MobileActionChild {
  icon?: string
  label: string
  disabled?: boolean
  onSelect?: () => unknown
}

export interface MobileAction {
  icon: string
  label: string
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  disabled?: boolean
  visible?: boolean
  iconClass?: string
  primary?: boolean
  overflow?: boolean
  badge?: number
  children?: MobileActionChild[]
  onSelect?: () => unknown
}

export interface MobileActionLayout {
  inline: MobileAction[]
  overflow: MobileAction[]
}

function cannotInline(action: MobileAction) {
  return action.overflow === true || Boolean(action.children?.length)
}

export function mobileActionLayout(actions: MobileAction[], maxInline = 3): MobileActionLayout {
  const inline: MobileAction[] = []
  const overflow: MobileAction[] = []
  for (const action of actions.filter(a => a.visible !== false)) {
    if (action.primary === true && !cannotInline(action) && inline.length < maxInline) inline.push(action)
    else overflow.push(action)
  }
  return { inline, overflow }
}

export interface MobileInfo {
  count?: number
  hasMore?: boolean
  loading?: boolean
  text?: string
}

interface MobileBarStore {
  version: Ref<number>
  actions: ComputedRef<MobileAction[]> | null
  info: ComputedRef<MobileInfo | null> | null
}

function getStore(): MobileBarStore {
  const app = useNuxtApp() as unknown as { __mobileBarStore?: MobileBarStore }
  app.__mobileBarStore ??= { version: ref(0), actions: null, info: null }
  return app.__mobileBarStore
}

export function useMobileBar() {
  const store = getStore()

  function registerActions(source: ComputedRef<MobileAction[]>) {
    store.actions = source
    store.version.value++
    onScopeDispose(() => {
      if (store.actions === source) {
        store.actions = null
        store.version.value++
      }
    })
  }

  function registerInfo(source: ComputedRef<MobileInfo | null>) {
    store.info = source
    store.version.value++
    onScopeDispose(() => {
      if (store.info === source) {
        store.info = null
        store.version.value++
      }
    })
  }

  return { store, registerActions, registerInfo }
}

export function headerActionsToMobile(actions: HeaderAction[]): MobileAction[] {
  return actions
    .filter(a => a.visible !== false)
    .map(a => ({
      icon: a.icon,
      label: a.label,
      color: a.color,
      disabled: a.disabled,
      onSelect: a.onSelect,
      children: a.children?.length
        ? a.children.map(c => ({ icon: c.icon, label: c.label, disabled: c.disabled, onSelect: c.onSelect }))
        : undefined
    }))
}