# Grok Bot voice runtime

Status: candidate `coke-grok-auth:candidate-voice-audio-20261114-r5` is deployed to the public Auth service from the single feature branch `codex/grok-bot-voice-audio`. Signed-in public Chrome verified persisted history after refresh, Qwen TTS playback controls, controlled dictation, and a realtime voice session using locally synthesized audio routed through BlackHole. That call returned transcript text and an assistant response; hangup persisted a `00:49` call record, the transcript expanded, and selecting `Good` produced the visible `Thanks for the feedback` acknowledgement. A second silent call verified that the floating call remains available while navigating to another Bot and that `Return to voice chat` selects the Bot that owns the call; hangup persisted a `00:50` call record. Public runtime hashes for the Auth bundle and UI assets match the local build. Audio playback audibility and upstream model identity were not independently verified. The earlier dictation mismatches were caused by Chrome remaining pinned to the built-in MacBook microphone when only the macOS default changed. Chrome is restored to the system-default microphone and CoreAudio input/output are restored to the MacBook devices. Only Auth was rolled; MySQL, Broker, Agent/Desktop Pods, and PVCs were left in place. Merge and annotated checkpoint tag remain pending final user review.

## Model routing

The app uses the existing private `COKE_GROK_MODEL_KEY_FILE` at the server boundary and `COKE_GROK_AUDIO_BASE_URL` for Token Plan audio APIs. The browser never receives the API key or the expiring signed TTS object URL.

| Product action | Model | Flow |
| --- | --- | --- |
| Voice input in the composer | `qwen-audio-3.0-asr-flash` | Browser records, converts to mono PCM16 WAV at 16 kHz, sends it to the authenticated Bot endpoint; recognized text is inserted into the editable draft and is not sent automatically. |
| Read a Bot reply aloud | `qwen-audio-3.0-tts-plus` | Auth service synthesizes MP3, downloads the short-lived Beijing object-store result over HTTPS, and returns audio bytes to the authenticated browser. |
| Realtime voice conversation | `qwen-audio-3.0-realtime-plus` | Same-origin authenticated WebSocket is proxied by Auth; the browser sends 16 kHz PCM and plays 24 kHz PCM. Hangup saves one duration-bearing voice-call record with its transcript to that Bot's history. |

Realtime voice is a direct voice conversation with Qwen. It does not invoke Pi/DeepSeek tools or Computer User actions. This avoids implying that voice chat has the Agent's task execution authority.

## Access and limits

- Dictation, speech, call-history and feedback routes require an authenticated session, same-origin request and ownership of the target Bot.
- Dictation accepts mono PCM16 WAV at 16 kHz, up to 10 MiB and five minutes. Speech text is capped at 3,000 characters; returned speech is capped at 20 MiB.
- TTS result downloads accept only the fixed Beijing result host and the `pre`/`prod` path for `qwen-audio-3.0-tts-plus`; redirects are rejected. The URL and its signature remain server-side.
- Realtime setup frames use masked WebSocket client frames and support the 16-bit extended payload length needed by the session configuration. Setup payloads are capped at 16 KiB.
- Voice calls are stored in a separate `bot_voice_calls` table so the normal message enum and records stay intact. Each call stores a bounded duration, transcript and optional `good`/`bad` feedback, scoped through the owner Bot and tenant.

## Official interaction reference

- The official [Chat and collaboration guide](https://docs.x.ai/grok-bot/chat-and-collaboration) describes dictation as editable composer text, and live voice as a floating call that does not block navigation. While a call is active, the user can move between chats and return to it; call controls include mute, hang up, transcript and settings.
- The checked official Grok Bot 101 source-video frames around 46:42–47:13 show the compact floating call pill with status/waveform, settings, transcript, microphone and hang-up controls. At 47:12.600 the visible state changes to `Voice chat · 00:59` with feedback icons. The exact reviewed frame interval and PTS are recorded in `research/README.md` and the manifests named there.
- The official [Qwen realtime guide](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides) documents the Qwen 3.0 system voices and `speech_rate` from 0.5 to 2.0. Call settings now configure those values through a validated same-origin WebSocket query; changing a value reconnects the live session so the initial voice setting is applied before audio.
- The official [Realtime WebSocket flow](https://help.aliyun.com/en/model-studio/audio-realtime-websocket-access) specifies server VAD events in order: speech start, incremental ASR, final transcript, then assistant text/audio deltas. The [server-event reference](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-server-events) defines input ASR deltas as confirmed `text` plus tentative `stash`; the final `conversation.item.input_audio_transcription.completed.transcript` replaces that live draft.
- The current implementation keeps the floating pill and call session mounted while switching between Bots or opening the new-chat view. `Return` selects the Bot that owns the call. The live transcript is viewable from the pill. Hangup saves one conversation-row card with duration and transcript; the row expands to read the transcript and persists `Good`/`Bad` feedback. Transient socket disconnects retry with bounded backoff; manual hang-up cancels pending retries.
- Reference scope for this feature is limited to xAI's official Grok Bot documentation and the already-audited official demo-video frames. The video evidence log preserves source PTS and the transition at 47:12.600.

## Verification record — 2026-11-14

- `npm run test:voice`: 8/8 passed, including the realtime voice/speech-rate parameter allowlist.
- `npm run test:runtime`: 189/189 passed.
- `npm run build:deployment`: passed.
- Live Token Plan smoke checks used synthetic text only: TTS produced and downloaded audio; ASR recognized the expected phrase from that synthetic audio; an authenticated realtime WebSocket received `session.updated`.
- The live check found and fixed an initial WebSocket framing bug: the session configuration exceeded 125 bytes but the original client-frame encoder only supported short frames. The encoder now emits masked 16-bit extended frames; regression coverage includes lengths 3, 125, 126 and 1,024 bytes.
- Public Auth candidate `coke-grok-auth:candidate-voice-audio-20261114-r2` is Ready 1/1. Its `/app/auth.cjs` SHA-256 matches the local deployment bundle. The rollout replaced only Auth; MySQL, Broker, existing Agent/Desktop Pods, and PVCs were left in place.
- Signed-in public Chrome created a dedicated test Bot, sent a short synthetic prompt, and received a reply. The public reply card exposed `Read aloud`; clicking it changed the control to `Stop reading aloud` while speech was generated, then returned to `Read aloud` without a visible error. This verifies the public TTS interaction path; the UI does not expose an audio-provider trace, so it is not independent proof of the upstream model identity.
- The public task-result card initially lacked a read-aloud control because that control was only rendered for ordinary Bot messages. The same feature branch now adds it to completed task results, and the updated public build passed deployment compilation and the click check.
- Chrome already reports microphone access as enabled for the public site. No live microphone capture was started. Browser dictation, realtime audio exchange, transcript history expansion, feedback persistence, and navigation during an active call still need public-browser acceptance.
- The Chrome extension tab-binding call timed out at 30 seconds during this pass; native Chrome Computer Use and its accessibility tree remained available and were used for public UI acceptance. Keep these two control paths distinct and avoid repeated extension retries.

## Verification record — 2026-11-14 17:05 Asia/Shanghai

- Fixed a real-call duration race: the hang-up handler previously scheduled a React elapsed-time update and immediately serialized the prior render's `elapsed` value. It now freezes the wall-clock duration once at hang-up and reuses that exact value on save retries.
- `npm run test:voice`: 10/10 passed, including duration freezing, retry stability, negative-clock protection, and absent-call handling. `npm run build:deployment` passed.
- Built and imported `coke-grok-auth:candidate-voice-audio-20261114-r3`; the public Auth Deployment is Ready 1/1 on r3. Runtime `/app/auth.cjs` SHA-256 is `e9dc9cf2769b814ebb790157c207a4d9e05f83701d5047a80f65a918dff97771`, matching the local bundle. Container image ID is `sha256:5dda5ab625cc88d0c8b58cc4a39f32b5264ef503aefabaa7d124447315620a80`.
- Only Auth was rolled. MySQL, Broker, Agent/Desktop Pods, and PVCs were not changed. The immediate image rollback target is `coke-grok-auth:candidate-voice-audio-20261114-r2`.
- In the signed-in public Chrome UI, a refresh retained the dedicated voice test Bot and its prior conversation. Clicking `Read aloud` showed `Stop reading aloud` and `Generating speech…`, then returned to `Read aloud` without a visible error.
- No microphone permission was newly granted and no live microphone audio was captured. Public dictation, realtime audio exchange, cross-Bot navigation during a call, persisted call transcript/feedback, and full voice-call UI acceptance remain incomplete. Do not commit, merge, or tag this feature until its applicable end-to-end gates pass.

## Verification record — 2026-11-14 17:15 Asia/Shanghai

- Compared the realtime overlay against the official server-VAD event flow and fixed the missing incremental-ASR handler. It combines confirmed `text` and tentative `stash` into one live user-transcript row, then replaces that row with the final transcript instead of appending a duplicate. A new speech turn starts a fresh row and stops any prior assistant audio.
- `npm run test:voice`: 12/12 passed, including multi-delta replacement, final transcript replacement, separate subsequent turns, bounded text, and the hang-up duration fix. `npm run build:deployment` passed.
- Built/imported `coke-grok-auth:candidate-voice-audio-20261114-r4`; Auth is Ready 1/1. Runtime `/app/auth.cjs` SHA-256 still matches the local bundle: `e9dc9cf2769b814ebb790157c207a4d9e05f83701d5047a80f65a918dff97771`. Image ID: `sha256:1086a35ef66fda7edf59ffc42c5a356b8d6734eb4ffe6efa0e1b32c387640cc4`.
- Only Auth was updated. The immediate rollback target is `coke-grok-auth:candidate-voice-audio-20261114-r3`; MySQL, Broker, Agent/Desktop Pods, and PVCs were not changed.
- After rollout, signed-in public Chrome refreshed successfully; the dedicated test Bot and existing conversation remained visible with its read-aloud control. This is deployment/history UI evidence only. At that point no microphone had been started; see the later public dictation record below.
- Follow-up runtime regression: `npm run test:runtime` passed 189/189, including the Pi/DSH, Browser User, Computer User, screen scheduling, and persistence cases in the suite. This does not replace public microphone/realtime-call acceptance.

## Official voice UI comparison and deterministic input follow-up — 2026-11-14 17:59 Asia/Shanghai

- Re-opened the exact official xAI demo keyframes already recorded in `research/frames/v1-voice-chat-state-keyframes-20261106/`: `frame-000.png` shows a compact floating call pill with a green status dot, green waveform, settings, chat, microphone, and red close control; it has no visible status word. `frame-005.png` shows a centered inline `Voice chat · 00:59` row with waveform and thumbs up/down, without a large gray card, feedback prompt, or chevron. The visual source for these changes is the official xAI demo.
- Updated the local voice UI to match those observed shapes while preserving screen-reader status and transcript expansion. `npm run test:voice` passed 12/12 and `npm run build:deployment` passed. Public Auth remains r4; these visual edits are not deployed.
- With explicit user authorization, switched both macOS default audio devices to `BlackHole 2ch` and operated the public page's `Start voice input` / `Stop voice input` controls through native Computer Use. The first attempts still returned unrelated text. Chrome's microphone page exposed the reason: it remained explicitly set to `MacBook Air microphone (Built-in)` despite the CoreAudio default being BlackHole. After explicitly choosing `BlackHole 2ch` in Chrome and playing a short locally synthesized Chinese phrase, the public composer returned the exact phrase (normalizing the time to `8:30`).
- No test message was sent. The first attempts recorded from the built-in MacBook microphone, so that audio—not the known synthetic source—was submitted to the ASR endpoint; its content is not retained in project notes. The successful BlackHole draft was cleared. Chrome was restored to the system-default microphone; CoreAudio readback confirmed MacBook Air input and output; the settings tab and temporary audio files were removed.
- This confirms the public dictation/provider path for the known synthetic sample and identifies the earlier mismatch as Chrome retaining a per-browser input-device choice. It does not assess recognition quality across varied speech. The current composer path safely keeps recognition as an unsent editable draft.
- Next: verify live realtime audio, saved call history, feedback, and Bot switching through the public page. Keep the only feature branch uncommitted and untagged until its gates pass.

## Public dictation interaction — 2026-11-14 17:34 Asia/Shanghai

- Used signed-in public Chrome Computer Use on the existing dedicated voice test Bot. Chrome already showed microphone permission enabled; no permission or site setting was changed.
- Played a 2.15-second locally synthesized English test sentence while the product's `Start voice input` control was recording, then stopped capture. The first attempt displayed a generic transcription failure. A second attempt returned text and showed `Transcript added to the message. Review and send when ready.`, but the returned text did not match the synthetic sentence.
- No message was submitted; the unsent test draft was cleared and the public desktop page was restored. The UI path reached transcript insertion, but the mismatch means ASR accuracy is not accepted. The captured microphone source was not independently verified, so the mismatch cause remains unknown. Do not repeat live microphone capture until a deterministic synthetic input route is available; use the existing provider-level synthetic ASR checks as supporting evidence only.
- This did not exercise realtime call audio, incremental live transcripts, call save/feedback, or switching Bots during a call. Keep the feature uncommitted and untagged pending a reliable end-to-end path.

## Public realtime voice call — 2026-11-14 18:13 Asia/Shanghai

- Used signed-in public Chrome Computer Use on the dedicated `Voice E2E 20261114` Bot. With the user's explicit authorization, Chrome was explicitly set to BlackHole 2ch and a locally synthesized short Chinese utterance was routed to that input. The app showed the live call move from Connecting to Listening, rendered the synthetic utterance in its transcript, and returned the assistant response `遵命照办`.
- Hung up through the page control. The public UI displayed a persisted `Voice chat · 00:49` record; expanding it showed the transcript. Selecting `Good` changed the control to `Good, Value: 1` and displayed `Thanks for the feedback`, confirming the UI feedback-save path. No chat message was submitted. The response's audio playback audibility and the upstream provider identity were not independently verified; switching Bots while a call is active remains untested.
- During the earlier dictation attempts in this same authorized test session, Chrome remained pinned to the built-in microphone despite the CoreAudio default change. That built-in-mic audio was submitted to the ASR endpoint and is not retained; no message was sent and no ambient transcript was saved. The later controlled BlackHole dictation and realtime utterance used synthetic audio only.
- Restored Chrome's microphone to System Default and verified CoreAudio input/output as MacBook Air microphone/speakers. Closed the temporary Chrome microphone-settings tab. Removed the generated local audio and routing helper after verifying restoration.
- This is public runtime evidence for one controlled realtime audio-to-transcript/response round trip plus call-history and feedback UI. It does not establish broad ASR quality, audible TTS/realtime output, cross-Bot call persistence, or full voice-feature acceptance. Public Auth stays at r4; local UI changes remain undeployed, and the feature remains uncommitted and untagged.

## Public cross-Bot call navigation — 2026-11-14 18:28 Asia/Shanghai

- Public Auth r5 is Ready 1/1 on the existing K3D Auth Deployment. The runtime `/app/auth.cjs`, JavaScript bundle, and CSS asset hashes match local `dist` output. Only Auth was rolled; MySQL, Broker, Agent/Desktop Pods, and PVCs were unchanged. r4 remains the immediate image rollback target.
- Using signed-in Chrome Computer Use, started a silent realtime call on `Voice E2E 20261114`, switched to `E2E Test Bot 1029`, and observed the global floating call control remain available with `Voice chat in progress` and `Return to voice chat with Voice E2E 20261114`. Selecting Return restored the owning Bot and the call remained Listening. Hanging up through the page saved a `Voice chat · 00:50` record. This specifically verifies cross-Bot navigation continuity; it is not an audio-response test and the silent call has no transcript or feedback.
- The earlier separate synthetic round trip remains the evidence for live transcript/assistant response, saved transcript expansion, and Good feedback. The two public checks together verify the call lifecycle and navigation UI paths, with the limitations already listed above.
- For this authorized test, Chrome's pinned microphone was explicitly set to BlackHole 2ch; the cross-Bot call itself was silent. At completion Chrome was restored to the system-default MacBook Air microphone, and its settings tab was closed. macOS CoreAudio input/output remained on the MacBook Air devices. No capture of room audio was made during this silent navigation check.
- `npm run test:voice` passed 12/12, `npm run test:runtime` passed 189/189, and `npm run build:deployment` passed before rollout. `git diff --check` is clean. No screenshots were used for the public acceptance.
- Feature remains on the single branch `codex/grok-bot-voice-audio`; merge and annotated acceptance tag remain pending the user's final review.
