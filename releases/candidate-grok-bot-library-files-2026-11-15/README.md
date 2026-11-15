# Grok Bot Library candidate: generated files and media

This candidate adds a persisted, owner-scoped Library view for completed Bot run outputs. It excludes user-uploaded inputs, groups by recency, supports Files/Media/Pinned filters, and persists Pin/Unpin in MySQL. Pins appear before date groups in All and under Pinned in the Pinned filter.

- Public site: `https://codex.cokeagent.com/grok-bot/`
- Source branch: `codex/grok-bot-library-files`
- Source commit: recorded in `source/code-commit.txt`
- Rollout scope: one existing `coke-grok-auth` replica in Mac-local K3D.
- No Broker, Agent/Desktop, PVC, MySQL data, or VPS deployment is changed. Startup creates one idempotent additive `bot_library_pins` table.
- Previous Auth image: `coke-grok-auth:candidate-webhook-routines-20261115-r2`.
- Candidate Auth image: `coke-grok-auth:candidate-library-files-20261115-r1` (`linux/arm64`).

## Build and deploy

Run `scripts/build.sh` from the repository root while the source files match the recorded code commit. It creates the production artifacts, fixed-version ARM64 Auth image, image ID record and a local compressed image archive. The archive is intentionally excluded from Git; the image tag remains in local Docker/K3D and can be rebuilt from this release's recorded source patch and commit.

Before deployment, use the signed-in public UI to confirm all Bot screens are idle. Then run `COKE_GROK_PUBLIC_IDLE=1 releases/candidate-grok-bot-library-files-2026-11-15/scripts/deploy.sh`. The script requires the expected K3D context, the exact previous Auth image and one ready replica; it snapshots the deployment, imports the single candidate image and rolls only Auth.

Run `scripts/verify.sh` after rollout. To restore the previous Auth image, verify the public UI is idle and run `COKE_GROK_PUBLIC_IDLE=1 releases/candidate-grok-bot-library-files-2026-11-15/scripts/rollback.sh`. The rollback leaves the additive pin table and all user data intact.

## Acceptance status

This initial image was deployed and then superseded by r2. Public acceptance evidence and current deployment state are recorded in `../candidate-grok-bot-library-files-2026-11-15-r2/README.md` and `manifest.json`.
