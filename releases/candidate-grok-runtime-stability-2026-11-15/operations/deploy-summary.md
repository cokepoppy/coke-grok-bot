# Deployment record

- Time (UTC): `2026-11-15T10:36:08Z`.
- Cluster: Mac-local K3D `tp1121-sandbox-dev`; VPS tunnel was not changed.
- Auth image changed from `coke-grok-auth:candidate-signin-handoff-fix-2655b22-20261115` to `coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115`. Deployment revision 134; Ready 1/1; restart count 0.
- Broker stayed on `coke-grok-desktop-broker:candidate-skill-library-20261115-r2`, generation 51, Ready 1/1.
- The 7 Agent/Desktop Pod UIDs and phases were unchanged; all remained Running.
- MySQL Pod and PVC UID hashes were unchanged. No DB or PVC operation occurred.
- Public HTTP support checks: app page 200; readiness endpoint 204. These are availability checks only.
- Public signed-in Browser/Computer Use E2E remains pending: the active Computer Use channel disallowed the public Grok Bot URL. No BSE task was replayed and no browser-click acceptance is claimed.
- Rollback script restores only the previous Auth image and verifies Broker, computer Pods, and MySQL/PVC identity snapshots.
