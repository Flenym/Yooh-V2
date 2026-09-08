# Yooh Desktop Native (Windows)

This desktop client is a non-Electron wrapper built with `pywebview` (Edge WebView2).

## Build

```powershell
powershell -ExecutionPolicy Bypass -File desktop_native/build_windows.ps1
```

Artifacts:

- `dist/Yooh.exe`

By default, build does not generate a config file.
`Yooh.exe` already contains built-in defaults and can be shared as a single file.

Optional config export (if you explicitly need per-PC overrides):

```powershell
powershell -ExecutionPolicy Bypass -File desktop_native/build_windows.ps1 -IncludeConfig
```

Then you will also get:

- `dist/yooh-desktop-config.json` (optional)

## Config

Optional `yooh-desktop-config.json` fields:

- `app_name`
- `start_url`
- `fallback_url`
- `close_to_tray`
- `window_width`
- `window_height`
- `window_min_width`
- `window_min_height`
- `auto_reload_on_server_update`
- `version_poll_seconds`

## Environment overrides

- `YOOH_APP_URL`
- `YOOH_FALLBACK_URL`
- `YOOH_DISABLE_TRAY`
- `YOOH_DESKTOP_DEBUG`

## No reinstall workflow

The `.exe` is a thin client that opens Yooh Web.  
When you deploy backend/frontend changes, users do not reinstall the app:

- at every launch, the app requests fresh assets (launch nonce);
- during runtime, the app polls `/api/app-version` and auto-reloads when server runtime changes.

The app does not start its own backend server.
