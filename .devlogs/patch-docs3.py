import io
import re

def replace_block(path, start_marker, end_marker, new_text):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    start = s.index(start_marker.replace('\n', nl))
    end = s.index(end_marker.replace('\n', nl), start)
    s = s[:start] + new_text.replace('\n', nl) + s[end:]
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)

- What was tried: `@tuanmjnh/tm-types@0.1.0` installed from the npm registry into `cms-base`, and `useCategoryAdmin`'s list response typed as `Omit<ApiResponse<AdminCategory[]>, 'data'> & { data, tree }`.
- Why it was reverted on review: `ApiResponse` only contributes `success`, `error?` and `meta?`, and this client reads none of them; its optional `data` contradicts an endpoint that always answers with a payload, and the `Omit` that repairs that is longer than the four-line interface it replaced while hiding the guarantee behind two type operators. The other candidate in the same file, `ApiErrorBody`, is not a better home either: it models Nitro's three nesting levels (`data.error.code`, `data.data.error.code`, `error.code`) where the shared type could only stand in for the innermost `code`, so it would keep the wrapper union and add a `Pick`/`NonNullable` chain.
- Consequence: no dependency, no `minimumReleaseAgeExclude` line, no lockfile entry; `useCategoryAdmin.ts` is identical to its pre-adoption state and `pnpm verify:all` is 27/27. What the attempt did prove is the registry route itself — install, supply-chain gate, resolution — which `link:` could not offer, and that is the finding worth keeping.
- Not adopted: `tm-utils` is Hub-shaped (`deviceCredentialScope`, `parseUpstreamAiError`) and `tm-validators`' `PaginationParamsSchema` assumes page/limit offsets while every list endpoint here is cursor-based.

"""

replace_block('docs/v2/05-feature-parity.md',
              '### WEB-14 — first shared package from `tm-platform` (landed 2026-11-13)',
              '### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)',
              feature)

operations = """## Shared packages: the registry route (WEB-14, 2026-11-13)

`tm-utils`, `tm-validators` and `tm-types` are published at 0.1.0 and install from the registry with no Vite or Tailwind config, unlike the `link:` dependency that WEB-13 had to revert. Two mechanics are worth keeping from this attempt even though the type itself was reverted on review: `minimumReleaseAge` rejects a release this fresh until the exact version is listed in `minimumReleaseAgeExclude` (and then the lockfile must be pruned again before that line is removed, or every later install fails the supply-chain check), and a shared envelope is only worth importing where its shape matches the endpoint — `ApiResponse<T>` has an optional `data`, so an endpoint that always answers with a payload needs a local type that says so.

## `tm-hub` has the `StatusBadge` bug too (2026-11-13)

The same precompiled `resolveComponent('UBadge')` lookup fails in `tm-hub`, so its non-clickable pills (`app/pages/administration/{apps,configs,content,roles}.vue`) render as empty `<ubadge>` custom elements; the `clickable` ones draw a plain `<button>` and look correct, which is why a "pills render" check can pass while half the badges are invisible. Read from the running dev server (`:4000`): the package's module resolves `tm-hub/node_modules/.pnpm/vue@3.5.44…` — one Vue instance, unlike `tm-websites` — but the app's component registry holds only `RouterLink`, `RouterView`, `Icon`, `LazyIcon` and the i18n components, with no `UBadge`/`UIcon`.

So `tm-hub` needs only the registry half of the fix: a client plugin registering `UBadge` and `UIcon` from `#components`, with no `dedupe` and no `vue` dependency. `tm-websites` proved that mechanism on 2026-11-13 — with a single Vue instance and the two components registered, the pills drew `span[data-slot="base"]` with `bg-success/10` and real contrast ratios.

"""

replace_block('docs/v2/08-operations-and-verification.md',
              '## Shared packages: the registry works, `link:` does not (WEB-14, 2026-11-13)',
              '## Shared packages from `tm-platform` (WEB-13, 2026-11-13)',
              operations)

todo = """### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)

- Tried `@tuanmjnh/tm-types@0.1.0` from the registry for `useCategoryAdmin`'s list response; reverted on review because `ApiResponse` contributed nothing this client reads and its optional `data` fought an always-present payload. No dependency, no lockfile entry; `verify:all` 27/27 after the revert.
- Kept from the attempt: the registry route works (with the `minimumReleaseAge` gate), which is what `link:` could not offer.
- Found on the way: `tm-hub` shows the same empty-`StatusBadge` bug — its non-clickable pills are unresolved `<ubadge>` elements because the app registry has no `UBadge`/`UIcon`, even though it has a single Vue instance. The fix there is a client plugin registering both from `#components`; detail in `08`.

"""

replace_block('tasks/todo.md',
              '### WEB-14 — first shared package from `tm-platform` (landed 2026-11-13)',
              '### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)',
              todo)
