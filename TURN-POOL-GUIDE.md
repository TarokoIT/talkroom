# TURN pool and device audit — v2.3.0

Admin → 伺服器設定 contains seven independent slots A–G. Existing Metered
configuration is migrated into A; all rooms initially select A, with no backups.
Imports do not execute JavaScript. The credential snippet and account env file are
parsed as data, then saved through admin-only RPC. Secrets are never returned by
the management listing. Authenticated room sessions receive only their selected
ICE credentials. Replacing a slot increments its configuration revision.

Metered: import the ICE configuration plus METERED_DOMAIN / METERED_SECRET_KEY
text file. For self-hosted or other static TURN services, import only ICE JSON:

```json
[{"urls":"turns:turn.example.com:443?transport=tcp","username":"YOUR_USER","credential":"YOUR_PASSWORD"}]
```

Other providers' billing APIs and TURN REST HMAC credential generation are not
implemented by this static adapter. They require an additional provider adapter.
Use valid static credentials and enter usage manually for now. Empty usage means
unknown, never zero. Empty quota means use the Metered account quota, or no
configured limit for static providers. Configured caps cannot override a lower
provider quota. Different credentials from one Metered account share its quota.

Lamp states: gray unconfigured/disabled; green below 50%; yellow 50–95%; red over
95%; blue unknown/stale/unlimited. Black border means selected by at least one
room's routing configuration, not proof of current media traffic. The separate
probe checks this browser can allocate a relay candidate, not end-to-end audio.

Each room has primary, ordered backup list and active slot. When reported usage
reaches its effective quota, resolution chooses the first configured enabled
alternative with available/unknown quota. It stays on that alternative until an
admin reapplies a primary or that alternative exhausts. Usage query failures do
not prove TURN connectivity failures and do not alone trigger a switch. A missing
backup results in a visible error, not unapproved paid service.

Active clients refresh via turn-pool every 60 seconds. Provider query claims limit
Metered requests to once per slot per minute. No active clients/admin queries means
no polling. Provider reporting delay and browser background throttling can delay
switches. Switching rebuilds PeerJS using the existing room session and a newly authorized Peer ID;
brief audio interruption is expected. Static TURN credentials already issued to
a client are not revoked by changing settings; rotate them at the provider when
necessary. No accumulated browser RTP total is represented as billing usage.

Device audit starts with new sessions. Request-forwarded IP information is stored
with provenance implied by the column name, not asserted to be a verified physical
location or immutable identity. The browser supplies UA/platform/model when
available, app version, language, timezone, display mode, screen dimensions,
touch capability and connection-quality hints. No microphone audio, IMEI, MAC,
contacts or location permissions are collected. Browser fields are untrusted
diagnostics and are never used for authorization. The authoritative auth method
comes from auth.users, not user-editable metadata. Logs survive session deletion,
are admin-only, filterable and CSV-exportable. Missing historical data is not
backfilled; timeout disconnections are estimates.
