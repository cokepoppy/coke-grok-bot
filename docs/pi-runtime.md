# Pi runtime integration, in progress

The model is configured instance-wide. Bot data, sessions, workspaces and runs remain scoped to a user and tenant. Do not put a provider key in the tenant workspace, an image, a source file, Git, task events or logs. The model gateway accepts only short-lived, call-limited run capabilities and replaces the capability with the provider credential in its own process. The gateway is an internal service and must never be attached to the public ingress. A capability is still a bearer credential during its short lifetime and must not be recorded in task data or logs.

The gateway limits request size and output tokens, fixes the configured model and upstream route, disallows redirects, suppresses provider error bodies, aborts on revocation or timeout, and redacts the raw provider credential even across streaming chunk boundaries. It does not by itself implement per-user network isolation or prove that an arbitrary process cannot steal a capability. Those boundaries are part of the pending computer and run integration.

`agent_runs` and `agent_run_events` are an additive MySQL queue schema. A request ID deduplicates creation per Bot. Claims lock the user's membership and permit at most one running or unresolved run across that user's Bots. Expired leases become `unknown`; they are not automatically retried, and they block later runs for that user until a future reconciliation mechanism resolves the uncertainty. The store is not yet wired into the production HTTP service or scheduler.

## Evidence

- 2026-10-29: `npm run test:model-gateway` passed with a simulated provider, including invalid capabilities, expiry, revocation, fixed-model validation, bounded calls and redaction across streaming chunks.
- 2026-10-29: `npm run test:run-store` passed against a temporary database on the separate stopped-after-test MySQL container, covering duplicate creation, cross-user denial, concurrent claims, and expired leases. Existing identity copies in that container were retained.
- 2026-10-29: the opt-in `test:pi-k3d` used the existing `coke-dots-linux-desktop:sha-c4caa5bb8dab2c9f731e4c2f1a71b25266469cfc` image, whose OCI revision is the same Dots commit and is an ancestor of the checked Dots `origin/main` `4213e769e49da7a479ab2ad186584c77b721fa69`. An isolated temporary K3D Pod ran the Dots Pi adapter, used an ephemeral TLS-protected gateway capability to call the real `deepseek-v4.1-flash`, and wrote the expected file in its own temporary task directory. The test observed two upstream requests. The provider key remained in the Mac-side gateway process; only the short-lived capability was sent to the Pod. Test Pod and temporary files were removed after the check.
- This is an isolated Pi/model/file-tool proof, not a signed-in public chat, durable user computer, computer-control, streaming-progress, DeepSeek Harness, or multi-user runtime acceptance. Those remain to be implemented and tested.

Run the real smoke only when explicitly working on the runtime and with an authorized key file:

```sh
COKE_GROK_MODEL_KEY_FILE=/path/to/private-key-file npm run test:pi-k3d
```

The command does not print provider responses or key contents. It requires Docker/K3D, the exact imported test image, and network access. It creates only a disposable test namespace, and leaves existing namespaces, PVCs, images and user data alone.

## Desktop image work

The in-progress desktop image builds on the pinned Dots image above. `deploy/desktop/start-desktop.sh` and `agent-runtime.mjs` were taken from Dots `origin/main` `4213e769e49da7a479ab2ad186584c77b721fa69`; these two source files are unchanged between that commit and the pinned base image's revision. The startup script is changed to leave the Agent runtime to a separate container. The runtime's task directories are group-accessible so the desktop worker and Agent can share the user's task files while running under different UIDs. Provisioning, ownership, live browser viewing and runtime integration remain unfinished.
