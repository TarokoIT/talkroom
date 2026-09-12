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

Normal rooms use the earlier duplex PeerJS audio architecture: a muted microphone is prepared on entry, one shared call carries both directions, and muting preserves the call. Broadcast remains one-way and listeners never return a microphone stream. Each newly initiated call requires a 30-second single-use server ticket tied to sender and recipient in the same room.
Receivers validate the ticket before answering. Normal members answer with their prepared microphone stream and play audio arriving on either an outgoing or incoming call. Broadcast listeners answer without a stream; controller outgoing calls never play returned media.
The backend denies listener transmission and cross-room tickets. Room snapshots remove calls from offline members; microphone-off members remain connected in normal rooms, with their received audio muted. Broadcast calls are removed when the controller stops transmitting.
Normal microphone toggles only enable/disable the local audio track. Simultaneous calls converge to one shared connection.

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
