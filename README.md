# TalkRoom v2.1.2

Six password-protected rooms: HK, FD, SEC, FB, BROADCAST, LOBBY.
Normal rooms allow 15 active devices. Broadcast allows one controller plus 15 listeners.
Broadcast listeners use a separate password from the controller and never request microphone access.
Homepage and in-room header display the version.

## v2.1 administration and records

`admin.html` uses separate Supabase Email/password authentication. Three owner-selected emails are allowlisted privately in the database; verified, non-anonymous accounts are required. Credentials and the allowlist are not embedded in the public frontend. Account activation is a separate owner step described in ADMIN-GUIDE.md.

Administrators can rename rooms, rotate passwords and revoke all sessions in a room. Rotation and revocation share the room admission lock. Compliant online clients exit at their next successful sync; offline clients cannot rejoin with an expired session. An unchanged shared password still permits re-entry, so rotate it when revoking a departed employee's access.

The public lobby RPC exposes room names and aggregate counts only, refreshed every 10 seconds. No identities, hashes, peer IDs or chat contents are exposed by the catalogue.

Text and lifecycle searches support room, inclusive Taiwan calendar date range and literal keywords. AND/OR combines active filter groups; a separate AND/OR option combines keywords. Pages contain 100 records. CSV exports one database snapshot, up to 10,000 matching records, preserves newlines, and escapes spreadsheet formulas. Oversized results require narrower filters.

Permanent text deletion always requires one room AND both dates. A five-minute, administrator-bound one-use preview stores the exact message IDs; new messages after preview are excluded. The operation records actor/scope/count and increments room history revision so clients refresh even when the latest message ID has not changed. Login/logout records are not deleted by this feature.

Session triggers record login, explicit logout, revocation, reconnection and timeout estimates. Unexpected disconnects cannot provide an exact logout time: timeout events use last heartbeat + 60 seconds and are materialized when logs are searched, a session reconnects or expired sessions are cleaned. Events before this rollout are not reconstructed.

The composer is multiline: Enter inserts a newline, Ctrl/Command+Enter sends. Microphone/listening controls share a row with right-aligned text settings. Member names are green/red for listening on/off; yellow backgrounds reflect local/received audio energy, not merely an enabled mic. Detection does not identify human speech versus background noise and is not audio recording.

## Architecture

GitHub Pages serves static HTML/CSS/JS. Supabase Anonymous Auth identifies each browser session without requiring an employee account.
Room passwords are bcrypt hashes stored in the private database schema, never frontend constants.
Authenticated calls to public.talkroom_api delegate to a private SECURITY DEFINER function with an empty search_path, explicit auth.uid() ownership checks and no direct client table grants.
The API derives the room, name and role from the server session; clients cannot choose a different room when reading/sending.
Room snapshots poll every two seconds; offline presence expires after 60 seconds and sessions expire after 16 hours.
Join attempts are limited to 10/minute per authenticated identity, in addition to Supabase anonymous-signup rate limits.

Normal rooms use direct PeerJS duplex calls: prepare a muted microphone on entry, call the peer ID from the authenticated room snapshot, and immediately answer with the prepared stream. No database request is awaited in the media offer/answer path. Microphone toggles preserve the duplex connection. Simultaneous offers converge to one call. Broadcast listeners answer without a microphone stream; controllers never play returned media.

Incoming calls are accepted only from PeerJS IDs in the last successful server-filtered room snapshot (maximum age 10 seconds). Caller metadata is not trusted. Normal rooms accept only members; broadcast listeners accept only their controller. Unknown peers are rejected and callers retry; an initial roster race can delay a call. Snapshot pruning removes departed members and stops audio on authorization loss. This restores the original direct-media approach with a room-roster gate, rather than per-call single-use tickets. The trust boundary is the PeerJS server's peer-ID association and the recent roster, not a cryptographic per-call credential. A revoked session may persist until the next successful snapshot (normally 2 seconds; after a failed sync, connections close if the last success is over 10 seconds old). Existing ticket database functions remain unused; no database grants or RLS policies are changed.

## Operations

Applied database/rooms-v2.sql, provisioned six room password hashes separately, then applied database/retire-v1.sql at cutover.
Original v1 tables and message records are preserved, but no longer accessible by browser roles. They are not mixed into the new rooms.
Only the publishable legacy anon key belongs in config.js; this is not a database administrator credential.
Room credentials are delivered separately to the owner, never committed.
Use the administration page to rotate room credentials and revoke sessions together. Controller and listener hashes remain distinct.

Existing v2 upgrade order: database/admin-v2.1.sql, database/records-v2.1.sql, database/update-admission-v2.1.sql, database/refine-session-events-v2.1.sql. These are one-time scripts; do not rerun initialization on the live database. Provision admin_emails separately using the owner's approved addresses. No actual chat deletion is part of the upgrade.

## Validation and limitations

Run npm test. database/test-rooms-v2.sql, database/test-admin-v2.1.sql and database/test-records-v2.1.sql run transactionally and roll back all fixtures.
Tests cover passwords, ownership, cross-room isolation, capacity, broadcast roles, voice tickets and replay prevention.
Browser UI verified for desktop/mobile layouts and actual listener login without a microphone prompt.
Android lock-screen playback and 15-device audio performance require on-site validation. Android private APK preparation is in ANDROID-PLAN.md; no APK has been built yet.
Current voice uses PeerJS P2P and STUN, with no TURN service configured; some networks may not connect.
Screen Wake Lock is requested while visible where supported; browser background audio is not guaranteed.
Supabase anonymous users persist independently of the expiring room sessions; administrators should monitor Auth usage.
The standard Supabase leaked-password checker applies to Auth password accounts, not these custom shared room passwords.
Security advisors still report private RLS tables with no policies (intentional default-deny; API-only access), old v1 anonymous policies (browser table grants have been revoked), and disabled Auth leaked-password protection. No new direct table access is granted.

## v2.1.1 voice investigation

An old in-flight presence snapshot no longer closes a newly authorized incoming call. Receiving a track no longer cancels the ICE connection watchdog: track creation does not prove packets can flow. The toolbar reports connected audio peers and timeout messages distinguish a missing answer from failed ICE connectivity. Receiving-side authorization errors are now visible. No TURN service has been configured. Local two-peer synthetic-audio testing is not a substitute for physical cross-network testing.

## v2.1.2 scoped restoration

Restored ordinary-room duplex capture/answer/playback and the third STUN endpoint from bd9f9ec, adapted to existing room authorization and broadcast isolation. No database, password, record-search, deletion, or chat-composer changes. HK/FD/SEC/FB/LOBBY are displayed as 一號頻道/二號頻道/三號頻道/四號頻道/五號頻道; stored room keys are unchanged. All endpoints should reload the new client together because old clients still prune calls on microphone-off. Local browser testing uses two actual app instances with a mock database, real PeerJS signaling and synthetic audio; physical Wi-Fi/4G verification remains necessary. TURN preparation remains separate and inactive.

## v2.1.3 direct voice restoration

Removed the remaining ticket/accept RPC waits and ticket metadata requirement from the media path. Kept the original PeerJS 1.5.2 and three STUN endpoints, prepared microphone and immediate answer. Room, admin, records, composer and channel labels are preserved. All devices must exit and reload together: old clients require ticket metadata and cannot accept this client's direct offers. Browser synthetic-audio testing cannot certify physical phone/PC connectivity.

Validation for v2.1.3: 11 committed Node tests pass. Two actual app instances with a mock room API, real PeerJS signaling and synthetic microphone audio passed simultaneous duplex send/receive, mute/unmute retention, leave cleanup, and broadcast receive-only/stop tests. No physical handset or 4G test was available to the agent.

## Seventh-room candidate experiment

candidate.html / candidate-app.js / candidate-core.js are isolated from the six-room production app. VOICE_TEST is a seventh private.rooms row, separately password-provisioned, capacity 15. Existing Auth, join/sync APIs and server room filtering apply. No schema, grants, RLS or production room credentials were changed. The homepage only adds a link. Existing admin APIs can manage this room; its internal code may appear as VOICE_TEST in administration.

Candidate media uses one active call map, immediate answer after the same recent-room-roster gate, microphone-off closes calls, and speaker mute depends only on the listener control. Removed the production collision arbitration and 45-second call watchdog for this comparison. Calls are still removed when the authenticated roster excludes a member or session authorization fails. This is a diagnostic candidate, not a rollout to the six rooms; it does not claim every remaining failure has been identified. Diagnostics are local-only without IPs, passwords, names, message contents or audio recording. The agent can use synthetic audio; normal users use microphone input.

SQL rollback validation passed wrong-password denial, correct-password admission, cross-room roster isolation and cross-session ownership rejection. No SQL test fixtures were retained. Manual phone/PC verification in this candidate remains required.
