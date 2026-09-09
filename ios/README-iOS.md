# Yooh for iOS — native SwiftUI client

Native iPhone app for the existing Yooh backend. No WebView, no wrappers,
no mock data: every screen talks to the real server (`src/server`).

- Language: Swift 5, SwiftUI, `async/await`, `URLSession`, `Codable`
- Architecture: MVVM + services (`@Observable`, iOS 17+)
- Realtime: dependency-free Engine.IO v4 + Socket.IO v5 client
  (long-polling with opportunistic WebSocket upgrade)
- Secrets in Keychain; UI state in UserDefaults (per-user)
- Design: native system components + Liquid Glass (`glassEffect` on iOS 26,
  material fallback below) — see `Yooh/DesignSystem/YoohTheme.swift`

## 1. Requirements

- macOS with **Xcode 16+** (Swift 5.9+ SDK, iOS 17 SDK)
- iPhone with iOS 17+ (or Simulator)
- Running Yooh backend (this repo, port 4200 by default)

## 2. Run the backend

```bash
npm install
npm run dev        # http://localhost:4200
```

## 3. Open and run the app

```bash
open ios/Yooh/Yooh.xcodeproj
```

1. Select the **Yooh** scheme → target device (Simulator iPhone or yours).
2. Set your **Development Team** (Signing & Capabilities) — required for devices.
3. `⌘R` to build & run. `⌘U` to run unit tests.

### Ready-made IPA via GitHub Actions

No Mac at hand? The repo builds an unsigned Release IPA in CI:

1. Push the `ios-client` branch (or press **Run workflow** on
   Actions → “iOS IPA (unsigned Release)”).
2. Download the **Yooh-ipa** artifact (`Yooh.ipa` + `BUILD_INFO.txt`).
3. The IPA is **unsigned**: install it with a sideload tool
   (Sideloadly / AltStore) using your Apple ID, which signs it
   during installation.
4. App icon is generated from `new_logo.png` (repo root) into
   `Assets.xcassets/AppIcon.appiconset` — replace the PNG and rebuild
   to change it.

### Point the app at your server

Default base URL is `http://localhost:4200` (works in Simulator).

- **Physical iPhone**: same Wi-Fi → backend prints `LAN access: http://192.168.x.x:4200`.
  In the app go to **Settings → Backend → Server URL**, paste the LAN URL,
  Apply (this logs you out — sessions live server-side), then log in again.
- **HTTPS production/tunnel**: paste the public URL the same way.

Local-HTTP (non-TLS) is allowed via `NSAllowsLocalNetworking` in `Info.plist`.
HTTPS hosts need no exception.

## 4. Sign in

OTP-only, exactly like the backend (`src/server/services/authService.js`):

- **Sign up**: phone → 6-digit code → name + `username` (5–32, `a–z 0–9 _`)
- **Log in**: phone **or** email → code → optional cloud-password (2FA) step
- Token (JWT, 30 days) is stored in **Keychain**; a dead token returns you
  to login automatically (same as web `resetToAuth()`).

## 5. Architecture map

```
ios/Yooh/
├── Yooh.xcodeproj/            # generated (see §8)
├── Yooh/
│   ├── YoohApp.swift          # entry: splash → auth → main tabs
│   ├── Info.plist             # permissions, ATS local-networking
│   ├── Assets.xcassets/       # AccentColor + generated AppIcon
│   ├── Config/AppConfig.swift # base URL, timeouts, limits
│   ├── DesignSystem/          # YoohTheme: spacing/radius/type + yoohGlass()
│   ├── Models/                # Codable mirrors of server JSON (tolerant decode)
│   ├── Networking/            # APIClient (single HTTP choke point)
│   │                          # + APIEndpoint (all routes) + Multipart
│   ├── Realtime/              # SocketIOPackets → EngineIOClient → YoohSocket
│   ├── Storage/               # KeychainStore, SessionStore, LocalPreferences
│   ├── Utilities/             # Validation, Formatters, Haptics, ImageCache,
│   │                          # VoiceNotes, LocationProvider, Device
│   ├── Auth/                  # AuthService (OTP/session REST)
│   ├── Services/              # Chat/Message/User/Media/Story/Call/Settings
│   ├── ViewModels/            # AppState (socket router) + per-screen VMs
│   └── Views/                 # Auth, Main, Chats, Chat, Contacts, Profile,
│                              # Settings, Stories, Calls, Components
└── YoohTests/                 # XCTest: codec, validation, JSON fixtures
```

Rules:

- Views never build `URLRequest`; services never touch SwiftUI.
- `APIClient` is the only place that sets `Authorization`, parses
  `{ error, details }`, retries idempotent GETs once, and fires
  `onUnauthorized` (global logout on 401).
- `YoohSocket` is the only place that speaks Socket.IO. `AppState`
  routes events: rows refresh, the open chat gets message events,
  presence/typing maps update, calls/stories refresh.
- Server JSON decoders are **tolerant** (unknown keys ignored, sensible
  defaults) so the app never crashes on a newer backend.
- Request encoders **omit nil keys** (`encodeIfPresent`) — the server's
  zod schemas accept missing keys but reject explicit `null`.

## 6. Backend contract used

Base `http://<host>:4200`. Auth: `Authorization: Bearer <JWT>`.

| Area | Calls |
|---|---|
| Auth | `POST /api/auth/register\|login/request-code`, `.../verify-code`, `verify-cloud-password`, `POST /api/auth/cloud-password`, `GET/PATCH/POST/DELETE /api/auth/sessions*` |
| Me | `GET /api/me`, `PATCH /api/me/profile`, `GET/PATCH /api/me/settings`, `GET /api/me/username-availability` |
| Users/chats | `GET /api/users/search`, `GET /api/chats/discovery`, `GET/POST /api/chats`, `POST /api/chats/join`, `PATCH/DELETE /api/chats/:id`, `POST .../clear-history`, members CRUD |
| Messages | `GET /api/chats/:id/messages|comments?limit&before`, `POST .../messages|comments` (`text\|location\|poll`), `PATCH/DELETE .../messages/:mid`, `POST .../reactions`, `.../poll-vote`, `.../forward`, `.../report` |
| Files | `POST /api/chats/:id/files` (multipart `file`), `GET /api/files/:id/inline\|download?token=` |
| Stories | `GET/POST /api/stories`, `DELETE /api/stories/:id`, `POST .../view`, `.../reaction` |
| Calls | `GET /api/calls`, `DELETE /api/calls/:id`, `GET /api/webrtc/config` |
| Misc | `GET /api/stickers/packs`, `POST /api/feedback`, support tickets |

Realtime (Socket.IO, default namespace, `auth: { token }`):
- → server: `chat:join` (**bare string** chatId), `chat:typing`,
  `chat:read` (ack), `call:start|accept|decline|hangup|signal`
- ← server: `chat:message`, `chat:message:updated`,
  `chat:message:deleted`, `chat:updated`, `chat:typing`, `chat:read`,
  `presence:snapshot|update`, `settings:updated`, `story:updated`,
  `calls:updated`, `auth:session-revoked`, `call:*`

Wire detail (verified live 2026-09-08): this server runs
engine.io-parser v6 — polling bodies are packets joined by ASCII RS
(`\x1e`), NOT length-prefixed (that was protocol v3), and the
handshake is one bare `0{...}` packet. `PacketCodec` implements exactly
this; `scripts/ios-smoke.mjs` proves it against the real backend.

## Design, themes & identity

- Visual style: dark premium by default, full light-mode support.
- **Settings → Appearance**: interface mode (System/Dark/Light), 5 accent
  colors, 4 chat wallpapers (+ System). Presentation-only, stored
  on-device (`ThemeStore`); accent recolors badges, send buttons, links.
- **Profile** (Discord-style, all server-backed via PATCH /api/me/profile):
  banner art, avatar, bio, emoji status (≤32 chars), avatar decoration —
  star emblem or photo frame (`premiumBadge`), profile color (`bgColor`).
- **Settings → Privacy**: last-seen, profile photo, calls, forwards
  audiences (everyone/contacts/nobody) + read receipts — enforced by
  the server (privacyRules.js). **Notifications** and **Data** sections
  persist via PATCH settings (deep-merged server-side).
- No mocks: every toggle/photo/status above hits the real backend.

## 7. How-to
**Add a screen**: View in `Views/<Area>/` + ViewModel in `ViewModels/`
(owns a service, never URLSession) + wire into `MainTabView` or a
`navigationDestination`. Reuse `AvatarView`, `ErrorBanner`,
`EmptyStateView`, `GlassIconButton`, `AsyncButton`, `yoohGlass()`.

**Add an endpoint**: case in `APIEndpoint` (method/path/query/body) →
method in the matching `*Service` → ViewModel call with `showError`.

**Add a message type**: extend `MessageType` + decode path in
`YoohMessage` + branch in `MessageBubbleView.content` (+ composer path).
Unknown types already render as plain text — never a crash.

**Regenerate the Xcode project** after adding/removing files:

```bash
python "$TEMP/opencode/gen_pbx.py"   # or re-run the script from ios docs
```

(The checked-in `project.pbxproj` was produced by this generator and
verified: 0 missing refs, 0 unreferenced files.)

## 8. Tests

`YoohTests/YoohTests.swift` — pure-logic coverage, no device needed:

- Engine.IO polling framing incl. emoji/UTF-16 length semantics
- Socket.IO event/ack/connect packet round-trips (`chat:join` bare string!)
- Validation parity (phone/username/code rules from `utils.js`)
- Real-shaped JSON fixtures: message, chat, error body, AnyCodable

Run: `⌘U` in Xcode.

## 9. Known limits (honest, no fakes)

- **Calls media**: history, deletion and incoming-call alerts are real;
  voice/video needs a WebRTC engine (`GET /api/webrtc/config` already
  wired). Tapping Call explains this instead of faking a call.
- **Secret chats**: the web app implements them device-local only
  (no server API); porting local-only secrets without real E2E would be
  theater — tracked in `ROADMAP.md`.
- **QR login, admin panel, playmode game, push (APNs)**: backend exists,
  client surface is roadmap (see `ROADMAP.md`).
- Sticker pack *creation* stays web/admin; viewing is in Settings.
- Chat folders stay web-side; pins/archive/mutes are local (same as web).

## 10. Found backend issues (not imported into the app)

During the audit these were found in `src/server` and deliberately
**not** reproduced client-side (see full list in the task transcript):
- File uploads skip quota checks that text messages enforce
- `DELETE /sessions/:id` removes every session sharing a `deviceKey`
- Public channels can't be discovered (`discovery` searches groups only)
- Live sockets survive session revocation until client disconnect
- Presence counter can stick at `online` with multiple tabs
- Infinite socket reconnect with an expired token (REST handles 401,
  the socket path didn't — the iOS client stops retrying on 401 instead)

### Verified by running the repo suite (Windows, Node 24)

- `npx vitest run tests/api.test.js` → **37/38 pass** on the untouched tree.
- The single failure (`system bot › does not deliver login code to
  support chat by default`, `tests/api.test.js:748`) **reproduces on
  pristine `master` too**: with the dev `mock` SMS provider,
  `SMS_FALLBACK_TO_SUPPORT_BOT=true` delivers the code to the support
  chat. Pre-existing backend behavior, left unchanged on purpose
  (fixing it would alter web behavior — backend changes are out of
  scope for the iOS stage).
