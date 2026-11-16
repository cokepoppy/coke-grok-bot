# Queue and deployment review

## Confirmed deployment mismatch

K3D Auth rollout revision 132 used `candidate-poll-loop-isolation-fe78069-20261115`. Revision 133 later replaced it with `candidate-signin-handoff-fix-2655b22-20261115`, which was built from an ancestor commit and omitted the later per-screen claim and independent poll-loop changes present on the active feature branch. This was a deployment-version mismatch; it is not evidence that the poller code itself failed.

## Current candidate

The current branch commit `b8c4b61` combines the false sign-in-handoff fix with per-Bot screen claim isolation and independent scheduler, routine, handoff, and expired-lease pollers. The Auth-only image is now deployed as revision 134. Local runtime tests passed 209/209, poller tests 2/2, focused scheduler/browser-policy tests 42/42, and the deployment build succeeded.

## Evidence boundary

Broker, Agent/Desktop, MySQL, and PVC identities remained unchanged across this rollout. The public page and readiness endpoint returned 200 and 204 respectively. Public signed-in Browser/Computer Use acceptance is still pending because the current Computer Use channel explicitly refused the public Grok Bot URL. Do not claim the BSE multi-Bot workflow is complete from these checks.
