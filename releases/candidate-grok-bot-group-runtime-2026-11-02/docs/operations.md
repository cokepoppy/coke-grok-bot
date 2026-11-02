# Candidate operations record — 2026-11-02

## Integration decision

The current feature branch was created from the exact latest `origin/main` commit (`0fab4081c2f2fbe78e73640a93e17f788b8ce8fb`). Yesterday's official-style UI is already in that `main` history, so no cherry-pick or merge from a stale UI branch was needed. The group-runtime changes are committed on `codex/grok-bot-persistent-group-chat` at `b1dacf2c6a2e2a9fa510e4134e71406beaa1ff41` and pushed to the matching remote branch. No other feature branch was opened. `main` has not been changed.

## Deployment scope

- Public entry: `https://codex.cokeagent.com/grok-bot/`.
- App, Pi/DeepSeek Agent runtime, MySQL, and cloud computers: Mac-local K3D cluster `k3d-tp1121-sandbox-dev`.
- Updated only the `coke-grok-auth` Deployment image and its `private-secrets` init image. Desktop broker, namespace bootstrap, MySQL Deployment/container, PVCs, other namespaces, and the VPS tunnel were not changed.
- The Auth startup added the group-chat persistence schema without dropping or rewriting existing records.
- The isolated test database container `coke-grok-group-test-mysql` was stopped after integration tests. The existing project MySQL container `coke-grok-local-auth-mysql` remains running.

## Verification

- `npm run build:deployment`: passed.
- `npm run test:ui`: passed.
- `COKE_GROK_TEST_MYSQL_PORT=13317 npm run test:runtime-mysql`: 16/16 passed against the disposable isolated test MySQL.
- `npm run test:run-browser`: passed with synthetic browser/runtime fixtures; this is supporting regression evidence only.
- Public Auth readiness: HTTP 204. Anonymous `GET /api/groups`: HTTP 401. Public JS/CSS hashes match the build artifacts in this package.
- Real signed-in public Chrome interaction was performed through the UI; no browser automation bypass was used.

## Real six-Bot group run

The `Offsite crew` group contained Chief, Sales Outbound, Inbox Manager, Account Manager, Talent Scout, and Expense Manager. A fresh task fan-out created six independent agent runs through the actual configured DeepSeek model service and per-Bot K3D cloud-computer Browser User. In the product UI, each navigation to `https://example.com/` was reviewed and approved. Every latest run card reached `Done`; all six computer activity cards returned a screenshot and reported the title `Example Domain` with no visible H1. This was a real public task, model request, approval flow, cloud-browser navigation, and screenshot return—not fixture output.

One earlier trial on the same candidate exposed a stale navigation-approval hash when a screenshot changed during Chromium focus. That trial had incomplete results and is not counted as acceptance. The approval comparison was corrected to bind the source page/state and destination while ignoring the volatile screenshot hash, a regression test was added, and the fresh six-Bot run completed. Optional unrelated keyboard actions in the fresh run were denied; they were not required for the task.

The result proves six queued/serialized Bot tasks on the single available screen slot. It does not prove concurrent multi-screen execution, Bot-to-Bot delegation, or full official product parity. Bot memory claims shown in model prose were not independently checked as persisted memory writes.

## Recovery boundary

`scripts/upgrade.sh` and `scripts/rollback.sh` are dry-run by default and refuse an unexpected cluster context or image pair. Their `--apply` mode changes only the Auth and `private-secrets` images. Rollback restores exact image `coke-grok-auth:group-68454dd39bc3` and keeps the additive schema, MySQL data, and PVCs. No rollback was applied while the candidate is under user review. No checkpoint tag was created; the user will do final product acceptance before merge/tag.
