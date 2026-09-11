# TalkRoom Android + Web preparation

Status: design prepared, no APK built or distributed. Web v2.1.0 remains the production client.

## Shared system

- Keep one Supabase project, room catalogue, shared-room credentials, session authorization and admin audit.
- Windows uses Chrome/Edge and Android uses an app; both join the same room and exchange messages/audio.
- Use an Android-native background audio service. A WebView wrapper alone does not establish reliable background audio.
- Preserve the existing one-use call authorization protocol or replace it consistently for both clients.
- PeerJS is a JavaScript signaling protocol, not a native Android WebRTC SDK. A native implementation must implement/test its signaling and SDP compatibility, or migrate both clients together to a shared native/web media SDK and SFU.
- Make that interoperability decision with a two-client proof of concept before selecting the final app framework.
- Keep room secrets out of APK and JavaScript. Store refresh tokens using OS-protected storage and re-check room session validity.

## Android implementation requirements

- Foreground service with visible ongoing notification and explicit leave/stop actions.
- Appropriate microphone/mediaPlayback foreground-service declarations and permissions; request microphone from a visible user-initiated flow before starting recording. Respect background-start restrictions.
- A receive-only device does not need microphone permission.
- Handle audio focus changes, phone calls, Bluetooth/wired-headset changes, Wi-Fi/mobile handoff, reconnects and process restarts.
- A silent room followed by new speech while the phone is locked is a required test, not just ongoing music playback.
- Do not silently start recording on reconnect. Default to listening and require explicit talk action.
- Use push-to-talk by default for mobile after the prototype is validated; support cancellation on touch release/cancel, focus loss, and permission completion after release.
- User force-stop, denied permissions, revoked room sessions and no network must be presented honestly; do not promise uninterrupted audio in those states.
- TURN with short-lived credentials is required before relying on mobile-data interoperability; choose provider/cost with owner. No TURN configured today.
- SFU should be evaluated for battery/network efficiency before 60-user rollout. Current broadcaster sends a separate P2P stream per recipient.

## Distribution

- Confirmed: private signed APK distribution for company devices; no Google Play release.
- Keep the release signing key backed up and private; subsequent upgrades require consistent signing identity.
- Use a stable applicationId, monotonic versionCode and explicit upgrade process.
- No signing key has been generated yet.
- Collect actual supported Android versions/device models for physical testing.

## Capacity baseline (from v2 code, not a load-test result)

- Normal room: 15 active sessions, 16th join rejected. Broadcast: 1 controller + 15 listeners.
- 60 logged-in clients polling every 2 seconds generate roughly 30 sync RPCs/second, plus messages/tickets/joins.
- v2.1 sends the latest known message id and history revision; unchanged history returns null instead of retransmitting 100 messages. It still polls and writes presence, so load testing is necessary.
- One talker in a 15-member room creates 14 outgoing audio connections.
- 15 simultaneous talkers could create 210 directed audio connections in that room; four such rooms can reach 840. Separate rooms do not directly call one another.
- 60 is not a hard global cap. Hardware, uplink, Wi-Fi airtime, signaling, Postgres latency and egress determine practical capacity.
- Test 15/30/60 clients with one and multiple talkers, measuring p95 RPC latency, failed joins, audio loss, reconnect time, CPU, egress and battery. Do not claim 60-user readiness from unit tests.

## Feedback control

- Use headsets or one loudspeaker per acoustic area; lower volume and separate speakers from microphones.
- Browser echo cancellation is already requested but cannot guarantee suppression of a multi-device acoustic loop.
- Push-to-talk reduces exposure time; it does not eliminate feedback when an adjacent speaker feeds the transmitting microphone.
- Fixed broadcasting workstations remain receive-only.

## Official references checked

- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/media/optimize/audio-focus
- https://developer.android.com/studio/publish/app-signing
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation
