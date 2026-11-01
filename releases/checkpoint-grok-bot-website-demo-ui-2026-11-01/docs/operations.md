# Operations record

## Scope

- Date: 2026-11-01 (Asia/Shanghai)
- Accepted scope: homepage website-demo UI and interaction polish from source commit `ea13873`.
- Product status: UI checkpoint only. The demo includes scripted UI states; it does not establish real model execution, Browser User, Computer User, tenant isolation, multi-screen concurrency, or full public acceptance.
- Database: no schema change or migration. Rollback leaves MySQL and PVCs untouched.
- VPS: no change. It remains the HTTPS reverse proxy/tunnel endpoint only.

## Validation evidence

- The UI E2E test, TypeScript/Vite build, and fixed-reference image comparison passed on this UI source state; see the dated entries in `research/README.md` for individual results and their limits.
- On 2026-11-01, `VITE_BASE_PATH=/grok-bot/ VITE_REQUIRE_AUTH=true npm run build:deployment` passed and produced `dist/server/auth.cjs` and the authenticated web bundle.
- Docker built `coke-grok-auth:sha-ea13873` for `linux/arm64` from pinned `node:24-bookworm-slim@sha256:2af38505da611a8d2729ed2b6235f04613a4d5cf8b9340d3ca7b0ac54d1462a5`.
- The running K3D deployment was read-only inspected before packaging: one of one auth replica ready on `coke-grok-auth:sha-5b66393`. Its containerd root filesystem layer IDs matched the host rollback image across all nine layers.
- No test, deploy, rollout, Pod stop, database operation, or PVC operation was performed for this checkpoint after the user accepted the UI.

## Recovery

Run `scripts/verify.sh` before using the package. `scripts/install.sh` without arguments displays a manifest diff for the expected local K3D context. Applying with `scripts/install.sh --apply` requires `COKE_GROK_NO_ACTIVE_RUNS_CONFIRMED=1`, imports the fixed image, and applies the copied manifests. `scripts/rollback.sh --apply` also requires that explicit no-active-runs preflight, and only proceeds if that deployment currently runs this checkpoint image; it then restores `coke-grok-auth:sha-5b66393`. Both scripts preserve MySQL/PVCs. `scripts/smoke.sh` checks the configured auth readiness endpoint without changing cluster state.
