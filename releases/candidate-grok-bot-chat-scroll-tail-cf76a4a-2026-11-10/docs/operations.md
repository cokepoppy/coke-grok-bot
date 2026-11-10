# Operations

- Source commit: cf76a4ab67f4b160abd52f90a779dd5a01bc6121.
- Rollout changes the existing Auth Deployment image only. Agent/Desktop, Broker, MySQL, PVCs, other namespaces and the VPS are unchanged.
- The preflight requires zero queued/running Agent runs and zero pending approvals.
- The rollout is one-for-one on the existing Auth Deployment; it creates no additional service or database container.
- Rollback restores the exact Auth image recorded in manifest.json.
- Local UI E2E covers authenticated long history, delayed and periodic run-history refresh, and newest-message visibility; deployment build passed.
- Public visible interaction remains pending because supported Chrome Computer Use calls timed out; no public message was sent.
