# Deployment record

- Time (UTC): `2026-11-15T10:36:08Z`.
- Cluster: Mac-local K3D `tp1121-sandbox-dev`; VPS tunnel was not changed.
- Auth image changed from `coke-grok-auth:candidate-signin-handoff-fix-2655b22-20261115` to `coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115`. Deployment revision 134; Ready 1/1; restart count 0.
- Broker stayed on `coke-grok-desktop-broker:candidate-skill-library-20261115-r2`, generation 51, Ready 1/1.
- The 7 Agent/Desktop Pod UIDs and phases were unchanged; all remained Running.
- MySQL Pod and PVC UID hashes were unchanged. No DB or PVC operation occurred.
- Public HTTP support checks: app page 200; readiness endpoint 204. These are availability checks only.
- At initial rollout time, public Browser/Computer Use acceptance was pending because the CUA channel refused the URL. On 2026-11-15 at 20:42 Asia/Shanghai, a new direct Test Bot task passed on this same candidate; see `public-e2e.md`. No unknown task was replayed.
- Rollback script restores only the previous Auth image and verifies Broker, computer Pods, and MySQL/PVC identity snapshots.

## Post-rollout verification

- Current Auth image remains `coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115`, imageID `sha256:04a2836d0a9fdd7d7e62485ae292f00c599420b6a968ad4357a10d7d33afdb6d`, Deployment generation 142 / revision 134, Ready 1/1, Pod restarts 0.
- Broker remains generation 51 on `coke-grok-desktop-broker:candidate-skill-library-20261115-r2`.
- The seven Agent/Desktop Pod UID set and MySQL Pod/PVC UID sets still match the recorded pre-deploy snapshots; `scripts/verify.sh` passed after the public task.
- Fixed MySQL integration suite passed 20/20 using the existing container, then the container returned to Exited. No business database, PVC, VPS, Broker, or computer Pod was changed.
