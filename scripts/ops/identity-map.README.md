# Customers migration — identity map (unblock)

The 3 legacy customers in `sen-tuan` are blocked because v2 requires a reviewed
`legacy userId → Hub subject` table (never by email).

Draft file: `scripts/ops/identity-map.sen-tuan.draft.json` lists the 3 legacy
userIds (keys) with empty subject values. Fill each value with the matching Hub
subject (OIDC `sub`) for that customer, then rename/copy to e.g.
`identity-map.sen-tuan.json` and run:

```
pnpm migrate:crm --site sentuan --identity-map scripts/ops/identity-map.sen-tuan.json --apply
```

Dry-run first (omit `--apply`) to verify counts. An empty subject keeps the
customer skipped, so do not leave placeholders.