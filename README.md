# Yooh

Yooh is a Telegram-style messenger MVP for Web and Desktop.

## iOS client (native SwiftUI)

Native iPhone app in `ios/` — Swift + SwiftUI, same backend, no WebView:

- Open `ios/Yooh/Yooh.xcodeproj` in Xcode 16+, run on iPhone/Simulator.
- Backend stays the same (`npm run dev` on `:4200`); point the app at it
  via Settings → Backend if running on a physical device.
- Full docs: [`ios/README-iOS.md`](ios/README-iOS.md)
  (architecture, API contract, realtime protocol, how-to guides).
- Roadmap iOS → Web → Windows: [`ios/ROADMAP.md`](ios/ROADMAP.md).

The web/desktop project below is untouched by the iOS client.

## Implemented

- Separate auth flows:
  - `register` (phone + OTP + displayName + username)
  - `login` (phone + OTP)
- Conflict handling for duplicate phone / username.
- Immutable numeric `chatid` per user and editable `@username`.
- Profile update API and settings API.
- Telegram-like settings sections:
  - Notifications and Sounds
  - Privacy and Security
  - Data and Storage
  - Appearance
  - Folders and Advanced
- Direct/group/channel chats.
- Channel comments in a dedicated stream (posts/comments).
- Public groups/channels with `@handle`:
  - discovery search
  - join by handle
- Realtime updates for new chats and messages via Socket.IO.
- Audio calls in direct chats (WebRTC + Socket.IO signaling).
- Admin panel:
  - OTP codes (`register/login`)
  - moderation (reports, bans, mutes)
  - platform stats
- File messages with limits and retention.
- Inline image preview in chat (not only download links).

## Quick Start

```bash
npm install
npm run dev
```

### Backend for the iOS test build (Windows, one click)

```bat
start.bat
```

Starts the local backend on `0.0.0.0:1111` (real entry point
`node src/server/index.js` with `PORT=1111`, admin on `:1112`).
Checks Node.js, installs deps if missing, verifies port 1111
(read-only — never kills foreign processes; reuses a previous Yooh
instance), prints local/admin/public URLs and keeps the window open.

Public test URL (CloudPub on this PC forwards it to local `:1111`):

- `https://yooh-test.cloudpub.ru/`

Live contract check (health, OTP auth, chats, messages, raw Engine.IO
realtime — needs the backend running):

```bash
BASE=http://127.0.0.1:1111 node scripts/ios-smoke.mjs
BASE=https://yooh-test.cloudpub.ru node scripts/ios-smoke.mjs
```

Open:

- Web app: `http://localhost:4200`
- Admin panel: `http://localhost:4200/admin`

Admin token default: `yooh-admin-local`

## Network Access (Wi-Fi / Mobile Internet)

### Wi-Fi (same local network)

1. Start server with `npm run dev` (default host is `0.0.0.0`).
2. In terminal, copy LAN URL from `LAN access: ...` line (for example `http://192.168.0.42:4200`).
3. Open this URL on another device in the same Wi-Fi.

### Mobile internet (outside your Wi-Fi)

Use one of these options:

1. Deploy backend+frontend on a cloud host with HTTPS (VPS + Nginx/Caddy, Fly.io, Railway, Render).
2. Expose local app temporarily with tunnel (Cloudflare Tunnel / localtunnel / ngrok).
3. Host only reverse proxy publicly and forward traffic to your app server.

Important: Socket.IO realtime and file upload/download should stay under the same public domain and HTTPS.
For audio calls over mobile internet, configure TURN server variables below.

## Launchers

NPM launchers:

- `npm run launch:web`
- `npm run launch:admin`
- `npm run launch:app`
- `npm run launch:all`
- `npm run launch:tunnel` (auto mode: cloudflared -> localtunnel fallback)
- `npm run launch:tuna` (forced localtunnel / tuna mode)
- `npm run launch:cloudflare` (forced cloudflared mode)

Windows one-click launchers:

- `run_web.cmd`
- `run_admin.cmd`
- `run_app.cmd`
- `run_all.cmd`
- `run_tunnel.cmd`
- `run_tuna.cmd`

## Tunnel (Tuna) Setup

For access from another city/country without VPS, run:

```bash
npm run launch:tunnel
```

If Cloudflare is unstable in your region (`530`, `1033`), use forced tuna mode:

```bash
npm run launch:tuna
```

You will see:

- `Public URL` (share this with other users)
- `App URL`
- `Admin URL`

Default tunnel behavior is now:

1. Try `cloudflared` first (no localtunnel password page).
2. If `cloudflared` is not installed, fallback to `localtunnel`.
3. Script probes `${PUBLIC_URL}/health` and auto-restarts tunnel when provider returns repeated 5xx (for example `503 Tunnel Unavailable`).

If fallback to localtunnel happens, script also prints:

- `localtunnel password` (the value required on `loca.lt` reminder page).

Optional environment variables:

- `TUNA_SUBDOMAIN` or `TUNNEL_SUBDOMAIN` (request a fixed subdomain)
- `TUNA_HOST` or `TUNNEL_HOST` (custom localtunnel host)
- `TUNA_PROVIDER` or `TUNNEL_PROVIDER` (`auto`, `cloudflared`, `localtunnel`, aliases: `tuna`, `lt`, `cloudflare`, `cf`)

Cloudflared quick install examples:

- Windows (winget): `winget install Cloudflare.cloudflared`
- macOS (brew): `brew install cloudflared`
- Linux: see Cloudflare docs for your distro

## Audio Calls (WebRTC)

- Calls are currently available for `direct` chats.
- Signaling is handled by Socket.IO on your backend.
- STUN works for many Wi-Fi/mobile combinations, but some networks require TURN.

Recommended production setup:

1. Run app behind HTTPS domain.
2. Configure TURN server for NAT traversal.

TURN/STUN environment variables:

- `STUN_URLS` (comma-separated, default Google STUN)
- `TURN_URLS` or `TURN_URL` (comma-separated TURN URLs)
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

## Desktop App (.exe, non-Electron)

Desktop app now uses native Windows WebView2 wrapper (`pywebview`), not Electron.

### Run desktop app in dev mode

```bash
pip install -r desktop_native/requirements.txt
npm run dev:desktop
```

### Build downloadable `.exe`

```bash
npm run desktop:native:build
```

Output files:

- `dist/Yooh.exe`
- no extra config file required by default

By default, closing the app window exits the app. Tray/background mode can be enabled explicitly via desktop config.

Desktop app is only a client wrapper and does not run a local Yooh backend.
Users connect to the built-in app URL (`start_url` / `fallback_url` defaults in desktop client).
After server deploys, reinstall is not required: app fetches fresh assets on launch and auto-reloads on server runtime updates.

Optional: if you need machine-specific URL overrides, build with:

```bash
powershell -ExecutionPolicy Bypass -File desktop_native/build_windows.ps1 -IncludeConfig
```

This additionally creates `dist/yooh-desktop-config.json`.

### Legacy Electron launcher (optional)

```bash
npm run dev:desktop:electron
```

## Quality Checks

```bash
npm run lint
npm test
```

## Environment Variables

- `PORT` (default `4200`)
- `HOST` (default `0.0.0.0`)
- `JWT_SECRET` (default `yooh-dev-secret`)
- `ADMIN_PANEL_TOKEN` (default `yooh-admin-local`)
- `MONTH_LIMIT_BYTES` (default `21474836480`)
- `FILE_LIMIT_BYTES` (default `2147483648`)
- `FILE_RETENTION_DAYS` (default `30`)
- `STUN_URLS` (default `stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302`)
- `TURN_URLS` / `TURN_URL`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`
