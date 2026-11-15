# Grok Bot poll loop isolation candidate

This candidate contains the Auth image for `codex/grok-poll-loop-isolation`. It separates
run scheduling, Routine dispatch, handoff delivery, and lease recovery poll loops.

Scope: roll only `coke-grok-auth` in Mac-local K3D context `k3d-tp1121-sandbox-dev`.
The public VPS remains a tunnel/reverse proxy. Do not restart Agent/Desktop, Broker, MySQL,
or any PVC for this release.

Before deployment, verify the signed-in public UI has no active `Working` tasks and no
computer screen owned by a human. Review any uncertain task outcomes first. The manual
queue review is recorded in `operations/queue-review.md`.

Run `scripts/deploy.sh` to verify the fixed image and expected old Auth image, snapshot
Auth/Broker and aggregate computer/PVC identity hashes, import the image, and roll Auth.
Run `scripts/verify.sh` after public Computer Use acceptance. `scripts/rollback.sh` restores
the previous Auth image only. The scripts never read or copy Kubernetes Secret values.

The image archive is a local recovery artifact; its SHA-256 is in `SHA256SUMS`.
