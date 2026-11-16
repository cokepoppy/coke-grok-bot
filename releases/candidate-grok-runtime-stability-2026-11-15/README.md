# Grok Bot runtime stability candidate

Built from `codex/grok-poll-loop-isolation` source commit `b8c4b61c61990c64779b086789bb84ab3cb51cd1` after runtime tests and deployment build. It combines independent background pollers, per-Bot screen claim isolation, and the corrected Browser User sign-in handoff boundary.

The rollout is Auth-only. It preserves the running Broker, Agent/Desktop Pods, MySQL Pod, and PVCs. VPS remains a tunnel only. No user data or credentials are included.

Public signed-in Browser User acceptance passed against this deployed image: a new Test Bot task used Pi with `deepseek-v4.1-flash` and completed a real Browser User navigate/click/inspect flow on the BSE demo page. Detailed evidence and limits are in `operations/public-e2e.md`. This does not prove the earlier group handoff issue is resolved or full product parity.

The candidate remains subject to the user's final experience acceptance. The K3D rollout is Auth-only; it preserves the running Broker, Agent/Desktop Pods, MySQL Pod, and PVCs. VPS remains a tunnel only. No user data or credentials are included.
