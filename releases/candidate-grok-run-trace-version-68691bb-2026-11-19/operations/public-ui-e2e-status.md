# Public UI and E2E status

- Release: `sha-68691bb482b4f07ca63c6d61436467f3f4fb5479`
- K3D: complete four-image `linux/arm64` build; deployed and consistency-verified across 7 application Deployments.
- Persistent state: one MySQL Pod and 3 PVC identities preserved.
- Public UI: after refreshing the signed-in Grok Bot page, the existing `kaka` run displayed the exact first-call provider rejection and the new explanation that no Browser/Desktop action ran and the run was not retried. The call chain showed `Receive model provider response` as the failure point.
- Public task E2E: not passed. The task stopped before Browser User because the selected model returned HTTP 403 `model_not_purchased`. The failed task was not replayed and no new task was submitted.
- Computer Use: extension tab binding timed out, then native Chrome accessibility succeeded via `getApp("Google Chrome")`. No screenshots were used.
- Remaining verification: after the provider enables an available model, submit a new read-only task through the public UI and verify Browser User, Computer User, persisted result, and the desktop cursor appearance. Do not report full E2E or pixel-level visual acceptance until those checks pass.

## Recheck — 2026-11-19 12:21 CST

- `COKE_GROK_CAPTURE_UI_ARTIFACTS=0 E2E_PROGRESS=1 npm run test:ui` passed. The local regression covers viewport-filling layout, hidden faux window controls, user/Bot/Computer colors, timeline ordering, and latest-message scrolling. This is synthetic local UI evidence, not public product E2E.
- `npm run release:verify-k3d -- sha-68691bb482b4f07ca63c6d61436467f3f4fb5479 --context k3d-tp1121-sandbox-dev` passed across the seven active application Deployments. The running `grok-user-00213195e832242e4afea5b264424355/desktop` contains the pinned noVNC cursor override with SHA-256 `20ab397d1b9deec9caf377cf461c53b4fe58bc57ac6bc5b888824f21632d90b4`, matching the repository source.
- Public `/grok-bot/` JavaScript `index-CRDMCzeI.js` and CSS `index-l19_Saz7.css` both returned HTTP 200 and matched the current local `dist/assets` SHA-256 exactly (`4eb14013e4417ba7405d1c81023d8c859972cf69d8bfe2690002be79ae5b3796` and `ec1d83a6a9d3578b565fa67278d732e6dcca4bca785064b57c7ee13997eff801`).
- Native Chrome accessibility exposed an existing public run call chain (`b503f6b7-b23b-4eb7-8c4c-86fcc4eadaa3`): its recorded release is the older `sha-029a46380c46505cbcdc66615b97d50b7562723f`, with 18 events, 5 failed, 0 unfinished. The first provider response failed HTTP 403 `model_not_purchased`; the Agent then exited 1. This historical trace has no Browser User or Computer User success and is not a task against release `sha-68691bb...`.
- No new task was submitted because the provider entitlement failure is unchanged; the previous run was not replayed. Public Agent → Browser/Computer E2E remains unpassed. Extension `getTab` and `getState` timed out; native `getApp("Google Chrome")` restored semantic access. No screenshots were used. The noVNC file's presence is verified, but the white vertical line's rendered appearance remains unverified without a visual acceptance method.
