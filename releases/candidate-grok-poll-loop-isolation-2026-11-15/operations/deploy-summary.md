# Deployment record

- Time (UTC): 2026-11-15T06:33:32Z
- Cluster: Mac-local K3D `tp1121-sandbox-dev`; VPS was not changed.
- Auth changed from `coke-grok-auth:candidate-library-files-20261115-r2` to `coke-grok-auth:candidate-poll-loop-isolation-20261115`.
- Auth Deployment generation: 138 -> 139; Ready 1/1; new Pod restart count 0.
- Broker remained on `coke-grok-desktop-broker:candidate-skill-library-20261115-r2`, generation 51, Ready 1/1.
- The Agent/Desktop Pod UID set hash, MySQL Pod UID set hash, and PVC UID set hash matched before and after.
- No Broker, Agent, Desktop, MySQL, or PVC was restarted or changed.
- Public signed-in UI was reviewed before rollout. The BSE research and E2E tasks had `Outcome unknown`; both screens said `Bot is in control`. `I checked · continue` was used after review. No visible task was `Working`, and no approval card was present.
- Public Computer Use acceptance remains pending because Mac locked again. The candidate is deployed but is not yet accepted as fixing runtime stalls.
- Rollback: `scripts/rollback.sh` restores only the previous Auth image.
