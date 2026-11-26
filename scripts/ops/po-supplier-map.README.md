# Purchase orders — supplier map (unblock)

The 6 purchase orders in `sen-tuan` were imported with `supplierId: null`. Their
legacy rows do name a supplier, but those ids (`69c4b2b8…`, `6a1b8d43…`) are
absent from every collection in every local database, so there is nothing to
resolve and the migration refused to invent one.

Draft file: `scripts/ops/po-supplier-map.sen-tuan.draft.json` lists the 6 order
codes with empty supplier values. Fill each value with a supplier **code**
(`SUP-SUPPLIER1` … `SUP-SUPPLIER3`) or its ObjectId, rename/copy the file to e.g.
`po-supplier-map.sen-tuan.json`, then run:

```
pnpm backfill:po-suppliers --site sentuan --map scripts/ops/po-supplier-map.sen-tuan.json
pnpm backfill:po-suppliers --site sentuan --map scripts/ops/po-supplier-map.sen-tuan.json --apply
```

- Dry run first: it prints every order, the supplier it would take, and the
  legacy supplier id it could not resolve. Nothing is written without `--apply`.
- An order that already has a supplier is kept; pass `--overwrite` to replace it.
- A blank value means "still unmapped" and is safe to leave in the file.
- The apply refuses a map that names an unknown purchase order, an unknown
  supplier or a deleted supplier, so a typo cannot assign silently.
- The write bumps the order `revision` and is guarded on the previous supplier,
  so a concurrent CMS edit is skipped instead of overwritten; a rerun is a no-op.
