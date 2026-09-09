# Roadmap: iOS → Web → Windows

## Stage 1 — iOS (this client, v1 DONE)

- [x] Project, architecture, theme, networking, models, auth, storage
- [x] Auth (OTP phone/email, cloud-password 2FA, sessions)
- [x] Chats list (search, pins/archive/mutes, swipe + context actions)
- [x] Chat screen (history + pagination, send/edit/delete, replies,
      forwards, reactions, polls + votes, locations, files, voice notes,
      typing, read receipts, channel comment streams, realtime)
- [x] Contacts + public discovery + group/channel creation + member admin
- [x] Stories (feed, viewer, reactions, creation)
- [x] Calls history + incoming alerts (media explicitly pending)
- [x] Profile, settings, language, sessions, cloud password, feedback
- [x] Liquid Glass pass (native `glassEffect` + system tab/nav bars)
- [x] Unit tests for codec/validation/decoding
- [x] Docs (README-iOS.md)

### iOS v1.1 candidates (in priority order)
1. **Call media (WebRTC)**: vendor WebRTC.xcframework, drive it with the
   existing `YoohSocket.callStart/accept/decline/hangup/signal` hooks and
   `GET /api/webrtc/config` TURN/STUN. In-call UI + CallKit + background
   audio. (All signaling paths already exist and are tested against the
   real server events.)
2. **APNs push**: server currently speaks web-push only; needs an APNs
   provider + device-token endpoint, then `UNUserNotificationCenter`
   integration here.
3. **QR login**: show `POST /api/auth/qr/create` + poll `.../status`
   for linking desktop/web sessions.
4. **Secret chats done right**: either shared local-only semantics with
   the web client or a real E2E protocol — never fake encryption.
5. **Chat folders + server pins**: port `yooh_chat_folders` semantics
   once the server exposes folder APIs.
6. **Admin console**: `x-admin-token` flows (moderation, broadcasts) —
   separate target/scheme, not in the main app.
7. **Playmode game bridge**: `POST /api/playmode/session` + embedded
   game view.

## Stage 2 — Web (separate track, do NOT mix into ios/)

The `master` web client keeps working untouched. Future web work:
port the iOS client's hardened behaviors back where valuable
(401 handling on socket reconnect, encode-without-nulls discipline),
plus any feature work decided separately.

## Stage 3 — Windows native (separate track)

`desktop_native/` (WebView2 wrapper) stays as-is until this stage.
A real native client reuses the audited API/socket contract documented
in `ios/README-iOS.md` §6 — same endpoints, same events.

## Non-goals (all stages)

- No mock APIs/users/messages/servers outside previews and tests.
- No backend rewrite to suit a client; backend changes only for real
  bugs or genuinely missing APIs, staying web-compatible.
- No WebView shells presented as "native".

## Honestly not portable without backend work

Studied against Luxora-scale references; each item below has NO Yooh
server API today, so shipping a client UI for it would be theater:

- Message requests / stranger gating (no API)
- Communities/Spaces, boosts, levels (no API)
- Gifts/Stars transfers, commerce (balances exist, transfers don't)
- In-chat message search (no search API; only users/discovery)
- Translation, voice-to-text (no API)
- Scheduled messages (no API)
- Secret chats with real E2E (web's are device-local only)
- Contact notes/birthdays (no API)

Ported instead as real local features: drafts, pins, app lock,
chat folders filter, archived view, themes/wallpapers/accents.
