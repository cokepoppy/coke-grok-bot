# Unknown outcome queue recovery candidate

This candidate packages source commit `53d40f1cc4febed0df5061626c7d3a2286299da4` for the repeated “The previous task may have run…” recovery card. The original run remains `unknown`; the migration does not replay it. It changes old `pending` unknown records to `auto_resumed`, removes the Review/Retry card and composer lock, and permits the next separately submitted task to run.

Only the Mac-local K3D `coke-grok-bot/coke-grok-auth` Deployment is updated. Agent, Desktop, Broker, MySQL, PVCs, VPS tunnel, and other namespaces remain unchanged. The image is pinned by tag and immutable image ID in `operations/image-id.txt`; the previous Auth image is recorded for one-step rollback. No database or user data is included in this folder.

Build with `scripts/build.sh`, deploy after verifying the preflight image in `scripts/deploy.sh`, confirm the signed-in public page, and use `scripts/rollback.sh` only if the candidate fails. Public acceptance is recorded in `operations/public-browser-acceptance.txt`. It confirms removal of the recovery card and that a new task can be composed; it does not claim the separate BSE research task succeeded.
