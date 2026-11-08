# 10 — Documentation reset verification

Date: 2026-11-06, extended 2026-11-07. Scope: documentation and AI guidance only.

## Deliverables

Canonical v2 index and architecture/domain/auth/UI/operations/AI guides; domain module layout conventions; legacy domain specifications (website and CMS extracted); complete domain-level legacy parity backlog; P0–P10 roadmap; ownership ADR; updated root/host agent instructions and queue; path-only source inventories; preserved v1 archive.

## Verification record

Local documentation checks passed using a parent-authored Node filesystem verifier (no project code execution). Figures below are from the run after the 2026-11-07 additions:

| Check | Observed result |
| --- | --- |
| Active Markdown set | 29 non-archived files: instructions, queue/questions, v2 guides, ADR, archive index and seven existing CMS project-skill guides; 17 archived originals excluded from active-link checks |
| Archived originals | 17 files, all present in `manifest.json` with no unmanifested extras |
| Local Markdown destinations | 175 checked, zero missing targets |
| Source inventory | 1,265 paths checked, zero missing files |
| Legacy feature paths | 854 paths checked (635 CMS, 219 website), zero missing files |
| Archive integrity | 17 of 17 original SHA-256 hashes matched |
| Active Markdown whitespace | Zero trailing-whitespace findings in active documents |
| `git diff --check` | Exit 0 on the 2026-11-06 documentation set; Git emitted line-ending conversion warnings for touched files, not whitespace errors |
| External documentation links | Six links recorded, not network-availability tested |

The inline verifier enumerated active Markdown files, resolved percent-decoded relative link destinations, checked every source-inventory and legacy-feature path, and recalculated archive SHA-256 values against `manifest.json`. Original archived Markdown links were intentionally excluded from active navigation checks.

Two defects were found and fixed during the extension, not glossed over: [tasks/questions.md](../../tasks/questions.md) linked the roadmap with a root-relative path that resolves from `tasks/`, and the first verifier run double-prefixed inventory paths. Both are corrected; the current run reports zero errors.

An independent read-only review of the canonical guides, decision record, host instructions, queue and archive entry found no material issues: it independently resolved all local links present at that time and confirmed that observed implementation, planned work and historical evidence are distinguished. That review read documents only; it did not run application code, read secrets or reopen legacy documents as new evidence.

No application PASS is claimed by this record.

## Evidence boundaries

The source inventory covers selected first-party feature directories: 920 CMS paths, 215 legacy website paths and 130 target paths. These counts are file inventory, not feature counts or behavior coverage. No environment-file contents or credential values are included.

The 17 archived originals include pre-existing dirty report/task changes. Their SHA-256 values were captured before moving. The archive entry point is [INDEX.md](../archive/v1/INDEX.md); the original one-line root README is retained separately, unchanged.

Legacy Markdown links inside originals are not repaired because originals remain byte-identical. Active links and archive integrity are checked separately. External URLs are not network availability guarantees.

## Not run

Application test suites, typecheck, lint, builds, browser/SEO/PWA tests, security exploit validation, migrations, provider/live Hub checks and production deployment were not run during this documentation-only reset. No runtime code, lockfile, customer assets or database records were changed by this documentation task. Existing runtime/asset/lockfile work was left intact. A separate `.gitignore` change appeared during the session and was not edited or reverted here. No commit or push was created.

The current `superpowers` ignore rule also matches archived subdirectories with that name. Two narrow negation rules in `.gitignore` now keep `docs/archive/v1/docs/superpowers/` eligible for version control, leaving other `superpowers` directories ignored; `git check-ignore` confirms all four archived files in that subtree are no longer ignored. All archived files exist and pass hash checks on disk. No files were staged, committed or pushed.

Local test artifacts created by the parallel implementation pass were also added to `.gitignore`: `cms-cookies.txt`, `cookies.txt`, `bulk-*.json` and `.inspect*.cjs`. `cms-cookies.txt` held live `tm_access_token` / `tm_refresh_token` values and was previously eligible to be committed; only cookie names were inspected, never the values. These files were not deleted, because the running session may still need them — they are only excluded from version control. Rotate those tokens rather than relying on the ignore rule alone, since the file remains on disk.

The next implementation phase is P1, subject to the authorization prerequisites in [the IAM guide](03-hub-auth.md). Completing this documentation does not complete the application rebuild.
