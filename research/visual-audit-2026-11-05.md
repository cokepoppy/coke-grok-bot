# Grok Bot visual audit — 2026-11-05

## Sources and scope

- Official reference: the live interactive product example embedded in `https://x.ai/bot`, inspected in visible Chrome on 2026-11-05. This is the website's interactive demo, not a video; no video frame or timestamp is claimed in this audit.
- Public product: the signed-in `https://codex.cokeagent.com/grok-bot/` page, inspected in the same Chrome window and viewport.
- The two pages were not captured at identical app-state or crop: the official workbench is embedded in a marketing page and was partially clipped while scrolling. Treat geometric comparisons below as visual observations, not pixel measurements.

## Official demo observations

- The embedded example contains six individual Bots and the `Offsite crew` group.
- The `Sales Outbound` thread shows messages attributed to `Account Manager` and `Chief`, a Computer task with a screen preview, and a routine-created event named `Overnight outbound`.
- The visible demo changes state as the page is scrolled; its Bot rail, chat and computer presentation are therefore separate comparison states. The computer toggle was reported as off while its target was outside the visible crop; no successful toggle transition is claimed here.
- The official reference screenshot supplied in the conversation shows a narrow Bot icon rail, central `Sales Outbound` chat, and a right Computer/Routines pane. That screenshot remains the reference for the open-computer state.

## Public product observations

- The existing six-Bot group opens a three-column layout. The right pane's `Computer` tab displays a real cloud-computer screenshot, labels it `Bot is in control`, and offers `Take control`.
- The sidebar is currently 336 CSS pixels wide and is user-resizable; the existing UI test verifies the compact 84-pixel icon rail. The public account's saved width is expanded, so its current chat column is narrower than the supplied compact-rail reference.
- The selected group contains prior E2E prompts and results. Those persisted messages are test history, not a visual-shell defect; this audit did not edit or delete that data.
- Several existing Bot records render the same red avatar. The UI renders each Bot's stored color and shape; this observation alone does not prove a rendering bug, so no account avatar data was changed.

## Public deployment and browser-control check — 2026-11-05

- The signed-in Chrome tab showed the public product title, account menu, Bots and Groups, and the cloud-computer entry. A native Chrome accessibility snapshot and screenshot were readable.
- `https://codex.cokeagent.com/grok-bot/` returned HTTP 200. Its JavaScript bundle matched local `dist/assets/index-jTkMKZVG.js` byte for byte (SHA-256 `f60742594395507614340e7983d7514113ebe63431251b23a3546da7c46d10ba`). This verifies the served frontend artifact, not backend or interaction acceptance.
- CUA's Chrome extension inventory listed the signed-in page and reference tabs, but claiming the existing tab timed out. Creating a tab with the unsupported `visible` option was rejected; retrying without options created a second public tab but timed out before control was returned. The temporary tab was closed through Chrome afterward.
- In the initial control attempt, native Chrome control could open and close the ChatGPT toolbar side panel, but clicks and text input aimed at the Grok Bot page did not change its visible state. Requesting the Codex desktop app through CUA was explicitly denied for safety. No alternate browser-control path was used in that attempt.
- At the end of that initial attempt, visible-click E2E was still unverified; the later successful visible keyboard interaction and public E2E are recorded below. A screenshot/accessibility snapshot, HTTP 200, or local K3D runtime pass cannot substitute for that acceptance.

## Next comparison and acceptance

1. Compare the public group and private `Sales Outbound` states against the official screenshot at the same viewport, including both expanded and compact Bot rails, the Computer screenshot/status and the Routines list.
2. Change CSS or interaction only for a confirmed product mismatch; keep persisted user data intact.
3. After any UI change, run the relevant UI/runtime regressions and repeat visible, signed-in public acceptance through the real Pi/DeepSeek and Mac-local K3D Browser User/Computer User paths. Pixel-level acceptance remains pending.

## Visible public multi-Bot E2E follow-up — 2026-11-05

- Later on 2026-11-05, native Chrome control through CUA successfully read the signed-in public page and operated the page with visible keyboard focus. This supersedes the earlier statement above that visible public clicks had not worked. The Chrome extension tab-claim timeout remains a separate limitation; no Work setting was changed or bypassed.
- In the public `Public Group E2E 2026-11-05`, all six Bots were asked to use their own Browser User once for a read-only navigation to `https://example.com/`, report the title and visible `h1`, and capture their own computer screen. The page result was `document.title = "Example Domain"` and no visible `h1`.
- Four group-run results completed with Browser and Computer evidence: Talent Scout, Expense Manager, Sales Outbound, and Chief. Sales Outbound and Chief each exposed the exact `example.com` navigation approval, which was approved through the visible UI.
- Inbox Manager's group-run navigation was not approved, although its screenshot showed the page already open. A new private Bot task then displayed the exact navigation approval; after approval it reported a successful one-time Browser navigation and Computer screenshot.
- Account Manager's group-run outcome was unknown. Its computer screen was inspected and showed Chromium on `example.com`; `I checked · continue` was selected without retrying that uncertain run. A new private Bot task then displayed the exact navigation approval; after approval it reported successful Browser navigation and Computer screenshot.
- This is behavioral evidence from the signed-in public UI, including visible approval cards and completed Computer activity. It does not independently correlate the run with a specific DeepSeek API request, and it does not establish pixel-level parity. The initial six-Bot group run surfaced approval and unknown-outcome handling gaps; two supplemental individual runs completed those checks.

## Fresh six-Bot public full-chain verification — 2026-11-05

- Sent a new read-only task through the signed-in public group UI, with one independent run for each member Bot: Chief, Sales Outbound, Inbox Manager, Talent Scout, Account Manager, and Expense Manager. Each task used Browser User for exactly one navigation to `https://example.com/`, then Computer User for the assigned cloud-computer screenshot.
- Approved only the six visible Browser approval cards for that exact read-only URL. The public UI then showed all six Bot messages as Done and all six Computer activities as Done. Each result reported the exact page title `Example Domain` and no visible `h1`; screenshots showed Chromium on example.com. No site links, forms, or sign-in flows were used.
- Refreshed the signed-in public page; the six results and Done states remained visible. A read-only MySQL query found exactly six run rows in the task's time window; each had `status=completed`, `recovery_state=none`, and `computer_used=1`. Each associated approval was `consumed`.
- The live auth Pod reported `COKE_GROK_PI_ENABLED=1`, engine `pi`, and model `deepseek-v4.1-flash`. The exact UTC run window (2026-11-04 21:47:35–21:52:24) contained six run records and 29 Model Gateway upstream responses, all HTTP 200, with zero rejected responses. The gateway log omits run IDs, so the provider-call evidence is correlated by the isolated time window and run count, not joined per individual run.
- Browser-control diagnosis: Chrome extension inventory listed the signed-in page and reference tabs, but binding an existing tab timed out after 45 seconds. The native Chrome accessibility tree remained readable; visible keyboard focus and Return successfully navigated the public app and approved each card. No Work setting was changed or bypassed. This extension-to-tab bridge issue is separate from the six successful in-product Browser User runs.
- This verifies the requested six-Bot public flow through the real Pi runtime, DeepSeek upstream, persisted MySQL run/approval records, and Mac-local K3D Browser/Computer paths. It does not establish pixel-level parity; frame-by-frame official video comparison remains outstanding.

## Matched official screenshot comparison — 2026-11-05

- The user-provided official demo screenshot `codex-clipboard-29bfd743-388e-4df9-918a-c899a11e6dbf.png` is 1990×1350. The authenticated product fixture is captured at 995×675 CSS pixels and 2× device scale, so this comparison uses identical raster dimensions and viewport scale.
- Updated the UI fixture to represent six individual Bots plus `Offsite crew` as a separate three-member group. The product sidebar hides the extra `Groups` heading in this compact screenshot state, matching the reference's uninterrupted list of six Bots followed by the group.
- The targeted UI E2E passed with assertions for the six-Bot/one-group state, three stacked group avatars, Computer activity prompt/status/screen, and Computer panel interactions. `npm run build` and `git diff --check` also passed.
- `scripts/compare-reference.ts` reported mean absolute error 16.2716, threshold-32 changed-pixel ratio 11.7761%, across 2,686,500 pixels. The prior authenticated-shell screenshot in this turn measured 24.0004 / 14.9730%; the first Computer activity-card alignment pass measured 16.2781 / 11.7825%. The small change from the latter shows that sidebar fixture semantics were not the dominant remaining visual error.
- The Computer screenshot served by this UI test is a synthetic fixture; this visual comparison does not validate the real K3D screen image or a fresh public task run. The earlier six-Bot public runtime E2E above remains the behavioral evidence; the UI changes below have not yet been published or retested through the public page.

## Two-column screenshot alignment follow-up — 2026-11-05

- Added the active Bot's activity time (`15:33` in the supplied state) above its timeline while the Computer panel is closed. The panel-open state keeps the existing top-aligned chat geometry and omits that marker, matching the two separate reference screenshots.
- Matched the expanded Bot list's first-row placement and avatar size to the supplied 1990×1350 screenshot. The local raster avatar bounds are 56×57 pixels at x=66, y=213; the reference bounds are 58×58 at x=64, y=205. Relative to the app window top, the vertical positions differ by about one pixel; the remaining absolute y offset comes from the two captures' outer window placement.
- `npm run test:ui`, `npm run build`, and `git diff --check` passed. The UI E2E now asserts the displayed activity time and the first expanded-list avatar's size and vertical position.
- Whole-frame comparison (`artifacts/reference-comparison/official-window-two-column-20261105`) reports MAE 11.9465 and threshold-32 changed-pixel ratio 8.1888% across 2,686,500 pixels, down from 16.2716 / 11.7761% in the prior screenshot comparison. This is visual fixture evidence only. Public deployment, signed-in screenshot comparison, and real runtime acceptance after these CSS changes remain pending.

## r3 public verification follow-up — 2026-11-05

- Auth-only r3 was deployed to local K3D and served through the public VPS tunnel. Signed-in Chrome reload showed the latest Sales Outbound task remained in history.
- One fresh Sales Outbound task navigated read-only to `https://example.com/?grok-r3-check=20261105-1412`; it reported title `Example Domain`, no visible h1, and captured the computer screen. Expanded trace showed Pi with `deepseek-v4.1-flash`, Browser User navigation/inspection, and Computer User screenshot success.
- Opening the in-product computer viewer displayed the cloud Chromium screen at the unique query URL, with `Bot is in control`. This is real runtime evidence for one Bot after r3, not for a new six-Bot group run.
- Fresh r3 six-Bot group acceptance passed through signed-in public Chrome. All six Bot tasks and Computer activity cards completed. Expanded details for each Bot showed Pi with `deepseek-v4.1-flash`, successful Browser User inspection/navigation, and successful Computer User screenshot. I opened each Bot's public computer screen and verified its unique query URL in the Chromium address bar. After reloading Chrome, the group and all six replies remained visible.
- Pixel-level visual acceptance remains pending. The measured screenshot comparison is a synthetic fixture; the extension `getTab` attach timeout is separate from successful native Chrome control and remains unexplained below the bridge boundary.
