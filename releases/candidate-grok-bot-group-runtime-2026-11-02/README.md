# Coke Grok Bot persistent group runtime candidate

Status: deployed public candidate; awaiting the user's final acceptance. No checkpoint tag has been created.

Public preview: https://codex.cokeagent.com/grok-bot/

This candidate starts from the existing official-style Grok Bot UI already on `main` and adds persistent group chats, 2–6 Bot fan-out, individual run status, and approval-aware recovery. Each member runs an independent real agent task. The Mac-local K3D cluster hosts Auth and cloud-computer workloads; the Tencent Cloud VPS remains only the HTTPS tunnel/reverse proxy.

## Package contents

- `source/`: source archive for the exact feature commit recorded in `manifest.json`.
- `artifacts/`: deployment build output.
- `images/`: fixed candidate Auth image and its exact pre-candidate Auth image in one Docker archive.
- `k3d/`: image-only strategic patches for the existing Auth Deployment.
- `scripts/`: checksum/image verification, public smoke, guarded upgrade, and guarded rollback.
- `docs/operations.md`: real public six-Bot run record and scope boundaries.

Verify with `scripts/verify.sh --require-images`, then inspect `scripts/upgrade.sh` and `scripts/rollback.sh` in dry-run mode. Applying the upgrade or rollback requires the explicit `--apply` flag. The scripts only change the `coke-grok-auth` Deployment; they preserve MySQL data, PVCs, other K3D workloads, and the VPS tunnel.

This is a candidate package, not an accepted checkpoint. Merge to `main` and an annotated recovery tag wait for the user's final acceptance.
