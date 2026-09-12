# Candidate 3 TURN test

Only candidate.html uses this configuration; production and TESt.html are unchanged.
Apply candidate-turn.sql, then populate candidate_turn_config privately with the
provider's ICE server array. Never put credentials in a migration or repository.
The browser joins VOICE_TEST first, fetches configuration through its owned active
session, then creates PeerJS with iceTransportPolicy=relay. Missing TURN fails closed.
Diagnostics report selected candidate types and packet counters, not credentials.

These are static test credentials, visible to authorized test participants in the
browser. Room logout does not revoke an already retrieved provider credential.
Rotate/delete the Metered credential after testing. Production should use short-lived
credentials. The 500MB free account stops service at its allowance.

Validation: SQL rollback test rejected foreign owner, production room, expired session;
owner received five servers. anon has no function access and authenticated has no
table SELECT. Existing unit tests and JS syntax checks pass; physical PC/4G audio
and sustained connectivity still require user testing.
