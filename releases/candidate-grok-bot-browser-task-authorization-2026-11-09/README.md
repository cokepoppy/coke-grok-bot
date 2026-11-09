# Generic Browser Task authorization candidate

This candidate grants a short-lived, run-scoped Browser User capability only when the signed-in user directly requests a browser task. It works across websites without per-site control allowlists. Ordinary navigation, searches, reading, and non-sensitive page interactions do not require per-step approval.

The Desktop Worker pauses for login or human verification and does not enter credentials. Consequential controls such as sending, deleting, publishing, purchasing, payments, and account/security changes remain protected. Website content never expands authorization.

## Current state

- Candidate r3 is deployed in the Mac-local K3D cluster; the VPS remains a tunnel only.
- Source refinements for search submit controls and ordinary account settings are prepared for a commit-specific r4 image. The deployment script refuses to roll Desktop while any Bot screen is user-owned.
- Public Chrome Gmail E2E was started through the product UI. The current cloud computer is user-controlled and shows Google's account chooser. No account was selected and no credentials or inbox content were accessed. Public Gmail acceptance is pending the user's sign-in handoff and task resumption.
- MySQL and the bound workspace PVC are preserved. No other namespace is targeted.

`manifest.json` maps the candidate source commit to fixed image names and local image IDs. `artifacts/dist` keeps the exact web/server build. `artifacts/runtime-images.tar.gz` and its checksum can be created by `scripts/export-images.sh`; that large OCI archive stays local and is intentionally excluded from Git. The pushed Git commit and image manifest provide the reproducible source reference.

## Operations

- Run `scripts/build.sh` from a clean feature-branch source commit to build commit-pinned images, the matching build output, local OCI archive, manifest, and checksums.
- Run `scripts/preflight.sh` and `scripts/deploy.sh` only after the Gmail handoff has returned control to the Bot and no task or approval is active.
- Run `scripts/verify.sh` after deployment.
- Run `scripts/rollback.sh` to restore the exact r3 Auth/Agent/Desktop pins while preserving MySQL and PVC.
