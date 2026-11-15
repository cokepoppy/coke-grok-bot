# Grok Bot Library candidate: generated files and media

This candidate adds a persisted, owner-scoped Library view for completed Bot run outputs. The chat title now opens Bot details, keeping the Library tab reachable while the computer toolbar remains dedicated to the computer panel. It excludes user-uploaded inputs, groups by recency, supports Files/Media/Pinned filters, and persists Pin/Unpin in MySQL. Pins appear before date groups in All and under Pinned in the Pinned filter.

- Public site: `https://codex.cokeagent.com/grok-bot/`
- Source branch: `codex/grok-bot-library-files`
- Source commit: recorded in `source/code-commit.txt`
- Rollout scope: one existing `coke-grok-auth` replica in Mac-local K3D.
- No Broker, Agent/Desktop, PVC, MySQL data, or VPS deployment is changed. Startup creates one idempotent additive `bot_library_pins` table.
- Previous Auth image: `coke-grok-auth:candidate-library-files-20261115-r1`.
- Candidate Auth image: `coke-grok-auth:candidate-library-files-20261115-r2` (`linux/arm64`).

## Build and deploy

Run `scripts/build.sh` from the repository root while the source files match the recorded code commit. It creates the production artifacts, fixed-version ARM64 Auth image, image ID record and a local compressed image archive. The archive is intentionally excluded from Git; the image tag remains in local Docker/K3D and can be rebuilt from this release's recorded source patch and commit.

Before deployment, use the signed-in public UI to confirm all Bot screens are idle. Then run `COKE_GROK_PUBLIC_IDLE=1 releases/candidate-grok-bot-library-files-2026-11-15-r2/scripts/deploy.sh`. The script requires the expected K3D context, the exact previous Auth image and one ready replica; it snapshots the deployment, imports the single candidate image and rolls only Auth.

Run `scripts/verify.sh` after rollout. To restore the previous Auth image, verify the public UI is idle and run `COKE_GROK_PUBLIC_IDLE=1 releases/candidate-grok-bot-library-files-2026-11-15-r2/scripts/rollback.sh`. The rollback leaves the additive pin table and all user data intact.

## Acceptance status

Build and MySQL API regression passed. Signed-in public Computer Use opened the current Bot's Details panel and Library, then clicked All, Files, Media, Pinned, Pages, Links and Apps. The page rendered the empty states for generated files/media and explicitly stated that this Library view currently supports generated files and media. The signed-in account had no existing output rows, so public card preview and Pin/Unpin were not exercised; MySQL runtime regression covers ownership, filtering and persisted pin behavior. The r2 image is deployed as the single Auth replica in Mac-local K3D; verification confirmed 1/1 Ready with Broker and Agent image configuration unchanged.
