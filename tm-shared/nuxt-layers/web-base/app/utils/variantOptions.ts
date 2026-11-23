/**
 * Variant option selection for a variable product.
 *
 * Legacy stores the distinguishing options on each variant as labelled pairs
 * (`Kích thước = 160X200`, `Màu sắc = Trắng`). The product page turns those pairs
 * into one group per option name and resolves a group/value choice back to the
 * variant that sells it. The functions are pure so they can be checked without a
 * browser, and keys never depend on the visitor's locale.
 */

export interface LocalizedLabel {
  [locale: string]: string
}

export interface VariantAttributeLike {
  name: LocalizedLabel
  value: LocalizedLabel
}

export interface VariantLike {
  sku?: string
  name?: LocalizedLabel
  attributes?: VariantAttributeLike[]
}

export interface VariantOptionValue {
  /** Locale-independent key, taken from the default locale of the option name. */
  key: string
  label: string
}

export interface VariantOptionGroup {
  key: string
  label: string
  values: VariantOptionValue[]
}

/** Group key -> value key. */
export type VariantSelection = Record<string, string>

function labelOf(value: LocalizedLabel | undefined, locale: string): string {
  if (!value) return ''
  const localized = String(value[locale] ?? '').trim()
  if (localized) return localized
  for (const entry of Object.values(value)) {
    const text = String(entry ?? '').trim()
    if (text) return text
  }
  return ''
}

/** The key a value is grouped under: the Vietnamese label, or the first one that exists. */
function keyOf(value: LocalizedLabel | undefined): string {
  if (!value) return ''
  const vi = String(value.vi ?? '').trim()
  if (vi) return vi
  for (const entry of Object.values(value)) {
    const text = String(entry ?? '').trim()
    if (text) return text
  }
  return ''
}

function variantAttributes(variant: VariantLike): VariantAttributeLike[] {
  return Array.isArray(variant.attributes) ? variant.attributes : []
}

/**
 * One group per option name, in the order the variants first mention it, with
 * each label once. Variants without options produce no groups.
 */
export function buildVariantOptionGroups(
  variants: VariantLike[],
  locale = 'vi',
): VariantOptionGroup[] {
  const groups = new Map<string, VariantOptionGroup>()

  for (const variant of variants) {
    for (const attribute of variantAttributes(variant)) {
      const groupKey = keyOf(attribute.name)
      const valueKey = keyOf(attribute.value)
      if (!groupKey || !valueKey) continue

      const group = groups.get(groupKey) ?? {
        key: groupKey,
        label: labelOf(attribute.name, locale) || groupKey,
        values: [],
      }
      if (!group.values.some(entry => entry.key === valueKey)) {
        group.values.push({ key: valueKey, label: labelOf(attribute.value, locale) || valueKey })
      }
      groups.set(groupKey, group)
    }
  }

  return [...groups.values()]
}

/** The selection a variant represents, so the page can highlight its option chips. */
export function variantSelection(variant: VariantLike | null | undefined): VariantSelection {
  const selection: VariantSelection = {}
  for (const attribute of variant ? variantAttributes(variant) : []) {
    const groupKey = keyOf(attribute.name)
    const valueKey = keyOf(attribute.value)
    if (groupKey && valueKey) selection[groupKey] = valueKey
  }
  return selection
}

/** A variant matches when it carries every selected option; extra options are allowed. */
export function variantMatchesSelection(variant: VariantLike, selection: VariantSelection): boolean {
  const attributes = new Map<string, string>()
  for (const attribute of variantAttributes(variant)) {
    const groupKey = keyOf(attribute.name)
    const valueKey = keyOf(attribute.value)
    if (groupKey && valueKey) attributes.set(groupKey, valueKey)
  }
  return Object.entries(selection).every(([groupKey, valueKey]) => attributes.get(groupKey) === valueKey)
}

/**
 * The variant a chip would select: it keeps every other option the visitor has
 * already chosen and swaps only `groupKey`. `null` means the combination does not
 * exist (the chip is rendered disabled).
 */
export function selectVariantWithOption(
  variants: VariantLike[],
  current: VariantLike | null | undefined,
  groupKey: string,
  valueKey: string,
): VariantLike | null {
  const selection = { ...variantSelection(current), [groupKey]: valueKey }
  return variants.find(variant => variantMatchesSelection(variant, selection)) ?? null
}

/** Whether choosing this chip leads to an actual variant, given the other choices. */
export function isVariantOptionAvailable(
  variants: VariantLike[],
  current: VariantLike | null | undefined,
  groupKey: string,
  valueKey: string,
): boolean {
  return selectVariantWithOption(variants, current, groupKey, valueKey) !== null
}
