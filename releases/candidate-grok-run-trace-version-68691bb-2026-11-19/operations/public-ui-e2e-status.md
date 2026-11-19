# Public UI and E2E status

- Release: `sha-68691bb482b4f07ca63c6d61436467f3f4fb5479`
- K3D: complete four-image `linux/arm64` build; deployed and consistency-verified across 7 application Deployments.
- Persistent state: one MySQL Pod and 3 PVC identities preserved.
- Public UI: after refreshing the signed-in Grok Bot page, the existing `kaka` run displayed the exact first-call provider rejection and the new explanation that no Browser/Desktop action ran and the run was not retried. The call chain showed `Receive model provider response` as the failure point.
- Public task E2E: not passed. The task stopped before Browser User because the selected model returned HTTP 403 `model_not_purchased`. The failed task was not replayed and no new task was submitted.
- Computer Use: extension tab binding timed out, then native Chrome accessibility succeeded via `getApp("Google Chrome")`. No screenshots were used.
- Remaining verification: after the provider enables an available model, submit a new read-only task through the public UI and verify Browser User, Computer User, persisted result, and the desktop cursor appearance. Do not report full E2E or pixel-level visual acceptance until those checks pass.
