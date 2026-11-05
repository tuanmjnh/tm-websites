---
name: mobile-bar
description: Standards and TypeScript contracts for useMobileBar composable, registering actions, and mobile/desktop unified action bar in TM Hub. Use whenever registering page actions, bottom nav actions, or header actions with useMobileBar.
---

# Mobile Bar & Unified Page Actions

All pages in `tm-hub` register their actions via `useMobileBar().registerActions()`.

## 1. Type Contract for `registerActions`

`registerActions` **requires** a `ComputedRef<MobileAction[]>`:

```ts
import type { MobileAction } from '~/composables/useMobileBar'

// ✅ CORRECT: Must be wrapped in computed(() => [...])
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-plus',
    label: t('chat.newChat'),
    primary: true,
    color: 'primary' as const,
    onSelect: startNewChat // Note: property name is onSelect, NOT handler
  },
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.reload'),
    onSelect: () => refreshData()
  }
]))
```

❌ **DO NOT PASS A RAW ARRAY**:
```ts
// ❌ WRONG: Passing raw array causes TS2345 type error in useMobileBar
mobileBar.registerActions([
  { id: 'new_chat', label: '...', handler: ... }
])
```

## 2. Properties of `MobileAction`

| Property | Type | Description |
|---|---|---|
| `icon` | `string` | Lucide icon name (e.g. `'i-lucide-plus'`) |
| `label` | `string` | User-facing localized label (from `t(...)`) |
| `onSelect` | `() => unknown` | Callback handler executed on click |
| `primary` | `boolean?` | Mark `true` for exactly one primary action (rendered prominently) |
| `color` | `'primary' \| 'secondary' \| 'success' \| 'warning' \| 'error' \| 'neutral'?` | Visual color token |
| `disabled` | `boolean?` | Disable the button |
| `visible` | `boolean?` | Conditionally show/hide action |
| `overflow` | `boolean?` | Force action into the `⋯` overflow menu |
| `children` | `MobileActionChild[]?` | Submenu items (e.g., CSV/JSON export) |

## 3. Registering Info Counter

```ts
mobileBar.registerInfo(computed(() => ({
  count: items.value.length,
  loading: loading.value
})))
```

