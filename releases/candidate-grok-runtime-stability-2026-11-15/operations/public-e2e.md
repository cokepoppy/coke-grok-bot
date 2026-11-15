# Public Computer Use acceptance

- Date/time shown by the signed-in public Bot UI: 2026-11-15 20:42 Asia/Shanghai.
- Public entry: `https://codex.cokeagent.com/grok-bot/`.
- Bot: `北交所端到端测试`; task was a new direct message, not a retry or replay of an old `Outcome unknown` task.
- Task destination: `https://c-m-ai-copilot.github.io/coke-bse-trading-demo/`.
- Runtime audit shown in the product UI: `Pi · deepseek-v4.1-flash · response received Browser User · inspect · succeeded Browser User · navigate · succeeded Browser User · inspect · succeeded Browser User · click · succeeded Browser User · inspect · succeeded`.
- Page title: `北证证券终端 · DEMO · 920999 N星澜`.
- Page environment: `纯前端演示 / 行情 合成 / 网络 0 请求`.
- Real page click: clicked `运行边界校验` once; no order, trade, reset, sign-in, screenshot, or group message.
- Results reported by the Bot from the populated page: 13.00 through/PASS; 13.01 rejected/PASS; 7.00 through/PASS; 6.99 rejected/PASS; 10.00 through/PASS. Total 5/5. Average ¥10.00; displayed upper/lower limits ¥13.00/¥7.00.
- Control path: Browser User only; all five listed calls succeeded and no approval card was shown.
- Scope limit: this proves one direct Test Bot task on the deployed Auth candidate. It does not clear the historical group handoff `Outcome unknown`, prove the Research Bot's original delegated browser run, cover zero/near-zero reference price, or establish full Grok Bot feature parity.

## Follow-up: Developer Bot blocked before write

- At 2026-11-15 22:33 Asia/Shanghai, the Developer Bot's new BSE implementation task reported `BLOCKED` before any repository write. No feature branch, commit, PR, merge, or deployment was created.
- The Developer Bot's own Chromium was on `https://github.com/login` with no signed-in GitHub session. Its terminal `git ls-remote` could not connect to `github.com:443`; raw GitHub and Pages egress also failed, and the REST request returned a shared-IP 403 rate-limit response.
- Its task/shared workspace had no repository checkout and did not include `receipt-seg2.md`. No credentials were entered. The Bot screen remained `Bot is in control` and exposed `Take control`.
- This is separate from the passing Test Bot Browser User run above. Local Mac Chrome Computer Use working does not prove the Developer Bot's cloud-browser login or terminal egress. GitHub sign-in and Git egress must be checked separately before retrying implementation.

## Follow-up: Agent terminal egress is isolated

- Read-only K3D inspection on 2026-11-15 22:54 Asia/Shanghai found no desktop-proxy or HTTP(S)_PROXY environment variable in three existing user Agent Deployments. Two inspected `agent-isolation` policies allow DNS and the Auth model endpoint on port 3002 only; one older namespace has an additional single host/port egress exception. Source `src/server/desktop-resources.ts` and `tests/desktop-resources.test.ts` confirm the generated Agent template is intentionally limited to DNS/Auth and omits the Desktop/Chromium proxy.
- The Mac can reach the target GitHub repository; Auth and Desktop Broker are Ready, and the host proxy bridge plus Clash listener are active. This does not repair or prove egress from an Agent task container. It explains the Developer task's terminal GitHub failure as an isolation boundary, distinct from the unauthenticated GitHub page in cloud Chromium.
- No policy, Agent environment, PAT, PVC, or user workload was changed. A namespace marked `desktop-worker-k3d` was identified as test-only and excluded from production conclusions. The Developer Bot's exact owner namespace is not yet mapped, so the current evidence supports the designed Agent isolation as the likely cause but does not prove that exact task's policy. Do not expose the general desktop proxy to Agent shells as a quick fix; use a repository-scoped server-side GitHub integration or design a separately constrained egress path. The BSE multi-Bot E2E remains incomplete.
- Computer Use recheck could enumerate the Chrome tabs once, but binding the BSE tab and the subsequent state read timed out. No new public UI interaction occurred.

## Follow-up: Computer Use reset and GitHub integration gap

- At 2026-11-15 23:04 Asia/Shanghai, the local Computer Use service process was present, but a fresh `getState` still timed out after resetting only the temporary CUA JavaScript session. This confirms process presence alone is not a healthy control path. No screenshots, raw CDP, Playwright, or API interaction was used for public acceptance.
- Source search found no branch/file/commit/PR capability for the authorized BSE demo repository. A fixed `create_incident_pull_request` helper exists for a different repository and predetermined branch; it only creates or reuses that incident PR. It cannot commit BSE code. Agent terminal egress remains intentionally isolated. The PAT file was checked only for existence and restrictive mode; its content was not read or injected into a Pod.
- The BSE public multi-Bot workflow is still incomplete. The only safe GitHub path identified is a server-side integration constrained to the authorized repository, with the PAT kept outside model-visible environments. No feature branch was added; the existing `codex/grok-poll-loop-isolation` remains the only active branch.

## Follow-up: Native Chrome Computer Use recovery

- After a `cua.getState()` timeout at 23:04, `cua.getApp("Google Chrome")` returned the native accessibility tree at 23:19 and semantic UI actions worked. The signed-in local Chrome repository tab is separate from the Developer Bot's cloud-browser session.
- The public Bot UI still showed the Developer Bot screen as `Bot is in control`; the latest task report remained blocked before writes. Tester and Ops `Outcome unknown` tasks were not replayed. No screenshots, coordinate clicks, or CDP were used.
- A login handoff was requested for the Developer Bot cloud computer. Await that sign-in and `Return to Bot` before retrying the repo task.
