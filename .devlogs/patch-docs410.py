import io

def load(path):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    return s.replace('\r\n', '\n'), nl

def save(path, s, nl):
    io.open(path, 'w', encoding='utf-8', newline='').write(s.replace('\n', nl))

def sub(s, old, new, where):
    assert s.count(old) == 1, '%s: %d' % (where, s.count(old))
    return s.replace(old, new)

# ---------- 08
p = 'docs/v2/08-operations-and-verification.md'
s, nl = load(p)

s = sub(s, "Colour contrast, screen-reader output and the 410 branch are not measured yet; 410 belongs to the next slice with the redirect map.",
"Colour contrast and screen-reader output are not measured yet. The 410 branch was exercised later, with a real redirect row — see the next section.", p)

s = sub(s, "| 410 | not exercised | There is no redirect mapping in the local data, and creating one would mean inventing data; the branch still needs a real mapping |",
"| 410 | `/probe-gone`, after the CMS stored a real `410` redirect row | the site's own error page with `Trang này đã được gỡ`, `noindex, follow`, `lang`, a single \"back home\" action (see the 410 section below for the full run) |", p)

s = sub(s, "Not verified: the client-side loading/pending affordance (it relies on the API answering slowly, which a local server cannot produce deterministically) and the 410 branch above.",
"""Not verified: the client-side loading/pending affordance (it relies on the API answering slowly, which a local server cannot produce deterministically).

## The 410 branch with a real redirect row (WEB-12.c, 2026-11-13)

The branch had no mapping in local data, and inventing one is off the table, so the row was created through the CMS the way an operator would create it, then removed with the same tooling. CMS `:4005` (mock session, `TM_WEB_REVALIDATE_URL`/`TM_REVALIDATE_SECRET` pointing at the storefront) and storefront `:4018` (`sen-tuan`), both stopped afterwards.

1. Baseline: `GET /probe-gone` → `404`; the `content_redirects` collection was empty.
2. `POST /api/v1/admin/redirects` with `{"from":"/probe-gone","to":"","statusCode":410,"note":"verify slice"}` and `x-audit-reason` → `201`, `x-storefront-revalidate: revalidated`, stored `revision: 1`.
3. Purge with the save's reason (`redirect.create` → `site` scope) → `removedCount: 0`: the CMS had already dropped the two site keys.
4. `GET /probe-gone` with `Accept: text/html` → **`410`** and the site's error page: `#__nuxt` shell, `h1` "Trang này đã được gỡ", the description from `error.contentGone`, `noindex, follow`, `Cache-Control: no-store`.
5. `{"from":"/probe-move","to":"/","statusCode":301}` → `201`; `GET /probe-move` → `301` with `Location: /`. So the gone row and the moving row do not interfere.
6. Cleanup through the CMS: `DELETE /api/v1/admin/redirects/<id>` answers `422` without `?revision=` and `200` with it; `content_redirects` 2 → 0, `content_revisions` 0, then the four `audit_logs` rows (two create, two delete) were removed and the collection's redirect entries went 4 → 0.
7. The redirect lookup caches a path for 30 s (`publicRedirects.ts`), so `/probe-gone` kept answering `410` briefly; once that entry expired it answered `404` again, and `/probe-move` `404` too — the deleted rows really are gone, not merely hidden.

One behaviour worth knowing when checking this with `curl`: without an HTML `Accept` header (curl's default `*/*`) Nitro answers a dev-mode JSON error envelope instead of the page. That is not specific to `410` — `GET /khong-ton-tai` behaves the same way and renders `Không tìm thấy trang` only when asked with `Accept: text/html` — so a check of these states must send a browser-like `Accept`.

Still not verified in this branch: the client-side `clearError({ redirect: '/' })` action (read from the DOM as a button, not clicked), and 410 for a path that also has content behind it.""", p)

save(p, s, nl)
print('08 updated')

# ---------- 05
p = 'docs/v2/05-feature-parity.md'
s, nl = load(p)
s = sub(s, "(pagination overflow fixed); 410, the pending affordance and colour contrast remain open |",
"(pagination overflow fixed); the 410 branch was then exercised with a real CMS redirect row, so the pending affordance and colour contrast remain open |", p)

s = sub(s, "## Storefront states and responsive widths (WEB-12.b, 2026-11-13)",
"""## 410 branch with a real redirect row (WEB-12.c, 2026-11-13)

The branch had no data to exercise, so a real row was written through the CMS and removed the same way. `POST /api/v1/admin/redirects` with `statusCode: 410` → `201` + `revalidated`; the storefront then answered `410` with its own error page ("Trang này đã được gỡ", `noindex, follow`, `no-store`), while a `301` row still redirected with `Location: /`. Cleanup: `content_redirects` 2 → 0, redirect `audit_logs` 4 → 0, and after the 30 s lookup cache expired both paths answered `404` again. The CMS delete route needs `?revision=` (`422` without it). Checks that send no HTML `Accept` get Nitro's dev JSON envelope for every error status, 404 included — the page needs a browser-like `Accept`. Steps and numbers in `08`. Remaining: the `clearError` back-home action was read but not clicked.

## Storefront states and responsive widths (WEB-12.b, 2026-11-13)""", p)
save(p, s, nl)
print('05 updated')

# ---------- todo
p = 'tasks/todo.md'
s, nl = load(p)
s = sub(s, "Still open by decision: the purge is secret-authenticated but not signed or replay-limited, and a CDN needs its own purge (Q12).",
"""Still open by decision: the purge is secret-authenticated but not signed or replay-limited, and a CDN needs its own purge (Q12).

**Slice 7 landed 2026-11-13.** The last unexercised storefront state is now checked with real data instead of being deferred: a `410` redirect row created through the CMS made the storefront answer `410` with its own error page, a `301` row still redirected, and both rows plus their four audit entries were removed afterwards (after the 30 s lookup cache expired, both paths answered `404` again). Recording it surfaced one trap worth keeping: errors checked without an HTML `Accept` return Nitro's JSON envelope, so 404 looked broken too. What remains unverified on WEB-12 is only the pending affordance, colour contrast and a click on the back-home button; the queue is empty again.""", p)
save(p, s, nl)
print('todo updated')
