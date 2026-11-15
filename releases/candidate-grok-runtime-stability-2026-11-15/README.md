# Grok Bot runtime stability candidate

Built from the current single feature branch after runtime tests and deployment build. It combines independent background pollers, per-Bot screen claim isolation, and the corrected Browser User sign-in handoff boundary.

The rollout is Auth-only. It preserves the running Broker, Agent/Desktop Pods, MySQL Pod, and PVCs. VPS remains a tunnel only. No user data or credentials are included.

The full public signed-in Browser/Computer Use acceptance remains pending; local test results and a ready Pod are supporting evidence only.
