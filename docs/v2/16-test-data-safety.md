# 16 — Test data-safety classification

Status: implemented 2026-11-24. Companion to [15 — local development and test policy](15-local-development-and-test-policy.md).

## Rule

Local development and `pnpm verify:all` run against the real `sen-tuan` database. A test suite therefore never clears, reseeds or migrates that database:

- A suite that needs a clean database opens a disposable `tm_test_*` fixture through [`scripts/build/testDatabase.ts`](../../scripts/build/testDatabase.ts), which refuses `sen-tuan` before connecting and refuses it again before dropping.
- Fixture databases are dropped by the suite's own `finally` path, so a failed assertion cannot leave one behind.
- Read-only and pure suites touch no database and may run against `sen-tuan` without writing.
- Backup/restore and other intentionally destructive drills target a fixture database, never the development one.
- `scripts/ops` destructive tools keep their own confirmation flags; they are manual operations, not gates.

## Classification

| Class | Database target | Cleanup | Where it is checked |
| --- | --- | --- | --- |
| Static / pure | none | n/a | `verify:test-safety` reports it as `no-database` |
| Read-only service | `sen-tuan` (reads only) | n/a | Code review + the suite's own assertions |
| Fixture write/integration | `tm_test_*` | `dropTestDatabase()` in `finally` | `verify:test-safety` refuses unguarded or un-dropped fixtures |
| Destructive drill (backup/restore, migration apply) | `tm_test_*` only | `dropTestDatabase()` in `finally` | same gate, plus the guard in `testDatabase.ts` |

`pnpm verify:test-safety` prints the current class of every suite. It fails on a `dropDatabase()` without the guard, a fixture that is opened but never dropped, a `sen-tuan` fixture literal, `syncIndexes()` in any script, or a direct `dropDatabase()` in `scripts/ops`.

## Adding a suite

1. Create the fixture with `const binding = testDatabaseBinding('tm_test_<name>')` (or `openTestDatabase` when the suite wants it cleared immediately).
2. Drop it with `await dropTestDatabase(connection)` in the `finally` block that closes connections.
3. Never add a collection-wide `deleteMany({})` or a direct `connection.db.dropDatabase()`.
4. Run `pnpm verify:test-safety`, then the suite itself.
