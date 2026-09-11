# Phase 1 — 2026-09-11

## v2.0.0 — six rooms and broadcast

Added six room cards, version labels, server-verified shared passwords and anonymous device identity. Room sessions, messages and one-use voice tickets live in a private schema; only the authenticated, ownership-checked API is exposed. Broadcast has separate listener/controller passwords and enforces one controller plus 15 listeners. Department rooms enforce 15 active members.

Deployed and verified GitHub Pages release 2378b4e. Browser tested actual listener login without microphone access, actual department login, and desktop/mobile layouts. Five frontend tests and transactional database permission/capacity/ticket tests pass. No physical microphone or 15-device load tests were performed.

Legacy tables retain records and RLS policies; only browser SELECT/INSERT/UPDATE/DELETE grants were revoked after cutover. The original broader retirement batch was rejected by automatic review and was not applied; database/retire-v1.sql records the narrower applied operation.

Room passwords are delivered in a local file outside this repository. Current limitations: no TURN, mobile background/lock-screen behavior needs physical testing. Supabase advisors may report private RLS tables without policies (intentionally no direct access) and legacy policies allowing anonymous roles (their table grants have been revoked).

Applied phase1-hardening.sql to Talk (zfnzhrcuwfejytftptio) with explicit user authorization. No application records deleted. Chat read/send and online presence operations remain available. Client chat deletion is disabled; duplicate chat policies and unnecessary grants removed; function search paths fixed. Supabase security advisors returned no findings after the change.

Frontend: escape message and username HTML, validate style values, disable the old delete-all command, keep calls when muting the microphone, load latest 30 messages, respect speaker mute for notifications, check heartbeat errors, and stop explicitly pausing audio when the document becomes hidden.

Validation: node --test tests/frontend.test.cjs (6 tests). No live microphone calls or production test messages sent.

Remaining: room authentication and isolation, ownership of online records, listener-only mode, TURN/reconnection, simultaneous call collision handling, page restoration, and physical iOS/Android background tests. Background browser playback is not guaranteed. This release does not implement six rooms or claim the system is fully secured.
