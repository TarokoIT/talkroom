# Phase 1 — 2026-09-11

Applied phase1-hardening.sql to Talk (zfnzhrcuwfejytftptio) with explicit user authorization. No application records deleted. Chat read/send and online presence operations remain available. Client chat deletion is disabled; duplicate chat policies and unnecessary grants removed; function search paths fixed. Supabase security advisors returned no findings after the change.

Frontend: escape message and username HTML, validate style values, disable the old delete-all command, keep calls when muting the microphone, load latest 30 messages, respect speaker mute for notifications, check heartbeat errors, and stop explicitly pausing audio when the document becomes hidden.

Validation: node --test tests/frontend.test.cjs (6 tests). No live microphone calls or production test messages sent.

Remaining: room authentication and isolation, ownership of online records, listener-only mode, TURN/reconnection, simultaneous call collision handling, page restoration, and physical iOS/Android background tests. Background browser playback is not guaranteed. This release does not implement six rooms or claim the system is fully secured.
