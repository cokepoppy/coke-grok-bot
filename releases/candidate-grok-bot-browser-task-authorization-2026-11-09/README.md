# Generic Browser Task authorization candidate

This candidate grants a short-lived, run-scoped Browser User capability only when the signed-in user directly requests a browser task. It works across websites without per-site control allowlists. Ordinary navigation, searches, reading, and non-sensitive page interactions do not require per-step approval.

The Desktop Worker pauses for login or human verification and does not enter credentials. Consequential controls such as sending, deleting, publishing, purchasing, payments, and account/security changes remain protected. Website content never expands authorization.

## Current state

- Candidate r3 is deployed in the Mac-local K3D cluster; the VPS remains a tunnel only.
- Source refinements for search submit controls and ordinary account settings are built as commit-specific r4 Auth/Agent/Desktop images with matching `dist`, manifest, checksums, and a local OCI archive. r4 is not deployed. The deployment script refuses to roll Desktop while any Bot screen is user-owned.
- Public Chrome Gmail E2E was started through the product UI. The latest visible Chrome observation shows the Gmail inbox, so Google sign-in has completed. The persistent computer is still owned by the user and the existing task remains `Review`; no message was opened or read, and no search, draft, or other mailbox action was performed. The candidate preflight correctly refused deployment while the screen owner is `user` (exit 21). Public Gmail acceptance is pending the user returning control and the same task resuming.
- MySQL and the bound workspace PVC are preserved. No other namespace is targeted.

`manifest.json` maps the candidate source commit to fixed image names and local image IDs. `artifacts/dist` keeps the exact web/server build. `artifacts/runtime-images.tar.gz` and its checksum can be created by `scripts/export-images.sh`; that large OCI archive stays local and is intentionally excluded from Git. The pushed Git commit and image manifest provide the reproducible source reference.

## Operations

- Run `scripts/build.sh` from a clean feature-branch source commit to build commit-pinned images, the matching build output, local OCI archive, manifest, and checksums.
- Run `scripts/preflight.sh` and `scripts/deploy.sh` only after the Gmail handoff has returned control to the Bot and no task or approval is active.
- Run `scripts/verify.sh` after deployment.
- Run `scripts/rollback.sh` to restore the exact r3 Auth/Agent/Desktop pins while preserving MySQL and PVC.
