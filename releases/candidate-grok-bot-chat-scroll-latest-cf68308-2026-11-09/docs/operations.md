# Operations

- Source commit: cf683081717fb80384a943c22dc32c8bbde0c5f6.
- Candidate changes only the Auth image. Existing Agent/Desktop and Broker image pins are recorded in manifest.json and remain unchanged.
- Rolled out at 2026-11-09T13:37:35Z to `k3d-tp1121-sandbox-dev`; Auth is 1/1 Ready on the candidate image.
- The rollout required zero queued/running Agent runs and zero pending approvals. It did not restart user-owned cloud-computer screens.
- MySQL, workspace PVCs, other namespaces and the VPS are outside the rollout.
- Rollback restores the exact Auth image recorded in the manifest.
- `npm run test:ui` passed for initial latest-message position, consecutive sends, asynchronous message growth, preserved history reading, and `window.scrollY === 0`.
- Public `/grok-bot/` returned HTTP 200. The JavaScript and CSS fetched through the VPS tunnel match `artifacts/dist` byte for byte.
- Signed-in Chrome was refreshed at the public URL; the long conversation remained at its newest messages, with the composer visible. This directly confirms the deployed initial-position fix. The UI regression also covers automatic bottom-follow after sending and while Agent content grows.
- Exact Auth rollback image: `coke-grok-auth:sha-3f79e8191457098c7f3e3dbdec7e70b9d8baaf08`.
