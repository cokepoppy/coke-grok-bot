# Deployment record

Candidate source commit and commit-pinned images are recorded in `manifest.json` after `scripts/build.sh`.

## Existing r3 pins

- Auth: `coke-grok-auth:browser-task-r3-20261109`
- Agent: `coke-grok-desktop:candidate-browser-task-r3-20261109`
- Desktop: `coke-grok-desktop:candidate-browser-task-r3-20261109`
- Broker: `coke-grok-desktop-broker:sha-e18f71547116d965c5abc5db9227b74729983588`
- Workspace PVC: `pvc-636987df-fa44-45f8-be00-bd8e88282b89` (Bound)

The r3 roll was verified in the existing public owner namespace. It changed Auth, Broker restart/configuration, and that owner's Agent/Desktop image pins only. It did not change MySQL, the PVC, the VPS, or other user namespaces.

## Current public acceptance state

A new Gmail task was sent through the visible signed-in Chrome product UI. The task paused because the cloud computer was under user control. The visible desktop is on Google's account chooser. No account was selected, credentials were not entered, and no inbox search/message/draft action occurred. Do not record this as a passing Gmail end-to-end test.

Return the cloud computer to Bot control after the owner completes sign-in. Then resume this task and verify the `is:unread` search, ordinary message reading without approval, any allowed unsent draft, and restoration of unread state. Do not quote message content or addresses in release logs.

## Candidate r4 deployment

The new build must use `coke-grok-auth:sha-<40-character-commit>` and `coke-grok-desktop:sha-<40-character-commit>` for Auth, Agent, and Desktop. Before deploying, `scripts/preflight.sh` verifies the exact r3 base pins, idle queues, Agent ownership of all Bot screens, and the same Bound PVC. A user-owned screen intentionally blocks deployment so the browser session cannot be interrupted. `scripts/rollback.sh` restores the exact r3 pins and never alters database or PVC resources.
