# Candidate operations record — 2026-11-02

## Change

Corrected persisted group-run status labels and fallback copy for acknowledged or retried uncertain outcomes. No Agent, model, computer, or MySQL schema change. Source commit: 3e06801a7329fba9d390165d352b4e730a7df76b.

## Runtime and deployment

- Public entry: https://codex.cokeagent.com/grok-bot/
- Auth and application state: Mac-local K3D context k3d-tp1121-sandbox-dev; Tencent Cloud VPS remains HTTPS reverse-proxy/tunnel only.
- Candidate image: coke-grok-auth:group-recovery-ui-20261102-r1 (sha256:5f64dd3d0c793fcdb0b55b391e0d1e17f1abba3b3d413c50ec0ddc5403f38695); rollback image: coke-grok-auth:group-approval-e2e-20261102-r1 (sha256:69dc86d0049bc169c03e35a73733f3935476de89d319492225ff1502bc1242fa).
- Changed only the `coke-grok-bot/coke-grok-auth` Auth Deployment `auth` and `private-secrets` image fields. Rollout reached 1/1 Ready.
- Public Auth readiness is HTTP 204; anonymous groups API is HTTP 401; public JavaScript and CSS SHA-256 matched this package.
- MySQL, tenant data, PVCs, desktop/Agent workloads, other namespaces and VPS configuration were preserved. No schema migration ran.

## Public visible-click E2E

At about 20:48–20:50 China Standard Time, signed-in Chrome opened the public VPS domain, selected `Offsite crew`, and submitted a new read-only task to all six existing Bots. The product UI presented approvals for navigation to `https://example.com/`; those approvals were clicked in Chrome. Expense Manager, Talent Scout, Account Manager, Inbox Manager, Sales Outbound, and Chief all reached `Done`. Each reported title `Example Domain`, no visible H1, and a Computer completion card. A page refresh restored the six results. Opening Chief's computer panel showed Chromium at Example Domain and `Bot is in control`.

K3D Auth recorded 27 successful `MODEL_UPSTREAM_OK` responses from 12:48–12:50 UTC. This is aggregate evidence during the run window, not exact per-Bot call mapping. The public E2E intentionally added one task and six run/result records to the existing user's group history; they were not deleted.

The first smoke request immediately after rollout timed out while the public route was recovering. A subsequent `scripts/smoke.sh` passed: readiness 204, anonymous groups 401, and exact JS/CSS hashes. Rollout itself reached 1/1 Ready. No rollback was applied.

## Regression and limits

`npm run build:deployment`, `npm run test:ui`, and `COKE_GROK_TEST_MYSQL_PORT=13317 npm run test:run-browser` passed. The last browser suite uses synthetic identity/executor fixtures and is supporting regression evidence only; the public visible Chrome run above is the product E2E.

The flow proves public six-Bot fan-out, model-backed tasks, in-product navigation approval, Browser User navigation, Computer screenshot return, and refresh-restored results. Current single-screen capacity serializes computer input; this does not prove concurrent physical screens, Bot-to-Bot delegation, public second-user isolation, pixel-perfect parity, or remaining official features.

## Branch and checkpoint

The single feature branch `codex/grok-bot-persistent-group-chat` is pushed at 3e06801a7329fba9d390165d352b4e730a7df76b; it remains under user review. Do not merge, tag, or start another feature branch until final acceptance.
