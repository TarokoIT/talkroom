# TalkRoom v2.0.0

Six password-protected rooms: HK, FD, SEC, FB, BROADCAST, LOBBY.
Normal rooms allow 15 active devices. Broadcast allows one controller plus 15 listeners.
Broadcast listeners use a separate password from the controller and never request microphone access.
Homepage and in-room header display the version.

## Architecture

GitHub Pages serves static HTML/CSS/JS. Supabase Anonymous Auth identifies each browser session without requiring an employee account.
Room passwords are bcrypt hashes stored in the private database schema, never frontend constants.
Authenticated calls to public.talkroom_api delegate to a private SECURITY DEFINER function with an empty search_path, explicit auth.uid() ownership checks and no direct client table grants.
The API derives the room, name and role from the server session; clients cannot choose a different room when reading/sending.
Room snapshots poll every two seconds; offline presence expires after 60 seconds and sessions expire after 16 hours.
Join attempts are limited to 10/minute per authenticated identity, in addition to Supabase anonymous-signup rate limits.

PeerJS streams are one-way. Each outgoing call requires a 30-second single-use server ticket tied to sender and recipient in the same room.
Receivers validate the ticket before answering without an outgoing stream. Outgoing calls never play a returned remote stream.
The backend denies listener transmission and cross-room tickets. Room snapshots remove calls from offline or no-longer-speaking senders.
Closing the mic closes outgoing calls only, preserving incoming audio.

## Operations

Applied database/rooms-v2.sql, provisioned six room password hashes separately, then applied database/retire-v1.sql at cutover.
Original v1 tables and message records are preserved, but no longer accessible by browser roles. They are not mixed into the new rooms.
Only the publishable legacy anon key belongs in config.js; this is not a database administrator credential.
Room credentials are delivered separately to the owner, never committed.
To rotate a room password, update its bcrypt hash in talkroom_private.rooms and revoke that room's sessions in the same administrative transaction.
Controller and listener hashes are distinct. A password change alone does not revoke an existing session.

## Validation and limitations

Run npm test. database/test-rooms-v2.sql runs transactionally and rolls back all fixtures.
Tests cover passwords, ownership, cross-room isolation, capacity, broadcast roles, voice tickets and replay prevention.
Browser UI verified for desktop/mobile layouts and actual listener login without a microphone prompt.
Real iPhone/Android lock-screen playback and 15-device audio performance require on-site validation.
Current voice uses PeerJS P2P and STUN, with no TURN service configured; some networks may not connect.
Screen Wake Lock is requested while visible where supported; browser background audio is not guaranteed.
Supabase anonymous users persist independently of the expiring room sessions; administrators should monitor Auth usage.
The standard Supabase leaked-password checker applies to Auth password accounts, not these custom shared room passwords.
