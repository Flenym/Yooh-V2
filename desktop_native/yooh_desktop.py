from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import webview
except ImportError as exc:
    print("Missing dependency: pywebview")
    print("Run: pip install -r desktop_native/requirements.txt")
    raise SystemExit(1) from exc

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    pystray = None
    Image = None
    ImageDraw = None


DEFAULT_CONFIG: dict[str, Any] = {
    "app_name": "Yooh",
    "start_url": "https://yooh.cloudpub.ru",
    "fallback_url": "http://localhost:4200",
    "close_to_tray": True,
    "window_width": 1440,
    "window_height": 900,
    "window_min_width": 980,
    "window_min_height": 640,
    "auto_reload_on_server_update": True,
    "version_poll_seconds": 15,
}
YOUTUBE_URL = "https://www.youtube.com"
YOUTUBE_VPN_SCRIPT = Path(r"C:\Users\ignat\OneDrive\Рабочий стол\zapret\general (ALT11).bat")


@dataclass(slots=True)
class AppConfig:
    app_name: str
    start_url: str
    fallback_url: str
    close_to_tray: bool
    window_width: int
    window_height: int
    window_min_width: int
    window_min_height: int
    auto_reload_on_server_update: bool
    version_poll_seconds: int


def get_project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return get_project_root()


def get_bundle_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return get_project_root()


def get_app_data_root() -> Path:
    base = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
    if base:
        root = Path(base) / "Yooh"
    else:
        root = get_runtime_root() / ".yooh-desktop"
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_session_state_path() -> Path:
    return get_app_data_root() / "desktop-session.json"


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def load_session_state() -> dict[str, str]:
    raw = load_json(get_session_state_path())
    return {
        "token": str(raw.get("token") or "").strip(),
        "lang": str(raw.get("lang") or "").strip(),
        "platform": str(raw.get("platform") or "").strip(),
    }


def save_session_state(payload: dict[str, Any]) -> None:
    path = get_session_state_path()
    safe_payload = {
        "token": str(payload.get("token") or "").strip(),
        "lang": str(payload.get("lang") or "").strip(),
        "platform": str(payload.get("platform") or "").strip(),
    }
    path.write_text(json.dumps(safe_payload, ensure_ascii=False, indent=2), encoding="utf-8")


def as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lower = value.strip().lower()
        if lower in {"1", "true", "yes", "on"}:
            return True
        if lower in {"0", "false", "no", "off"}:
            return False
    return default


def as_int(value: Any, default: int, min_value: int = 200) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(parsed, min_value)


def resolve_config() -> AppConfig:
    config = dict(DEFAULT_CONFIG)

    local_config_path = get_runtime_root() / "yooh-desktop-config.json"
    config.update(load_json(local_config_path))

    if os.getenv("YOOH_APP_URL"):
        config["start_url"] = os.environ["YOOH_APP_URL"].strip()
    if os.getenv("YOOH_FALLBACK_URL"):
        config["fallback_url"] = os.environ["YOOH_FALLBACK_URL"].strip()
    if os.getenv("YOOH_ENABLE_TRAY"):
        config["close_to_tray"] = as_bool(os.environ["YOOH_ENABLE_TRAY"], False)
    if os.getenv("YOOH_DISABLE_TRAY"):
        config["close_to_tray"] = not as_bool(os.environ["YOOH_DISABLE_TRAY"], False)

    return AppConfig(
        app_name=str(config.get("app_name") or DEFAULT_CONFIG["app_name"]),
        start_url=str(config.get("start_url") or DEFAULT_CONFIG["start_url"]),
        fallback_url=str(config.get("fallback_url") or DEFAULT_CONFIG["fallback_url"]),
        close_to_tray=as_bool(config.get("close_to_tray"), bool(DEFAULT_CONFIG["close_to_tray"])),
        window_width=as_int(config.get("window_width"), int(DEFAULT_CONFIG["window_width"])),
        window_height=as_int(config.get("window_height"), int(DEFAULT_CONFIG["window_height"])),
        window_min_width=as_int(config.get("window_min_width"), int(DEFAULT_CONFIG["window_min_width"])),
        window_min_height=as_int(config.get("window_min_height"), int(DEFAULT_CONFIG["window_min_height"])),
        auto_reload_on_server_update=as_bool(
            config.get("auto_reload_on_server_update"),
            bool(DEFAULT_CONFIG["auto_reload_on_server_update"]),
        ),
        version_poll_seconds=as_int(
            config.get("version_poll_seconds"),
            int(DEFAULT_CONFIG["version_poll_seconds"]),
            min_value=5,
        ),
    )


def is_url_reachable(url: str, timeout: float = 3.5) -> bool:
    if not url:
        return False
    try:
        request = Request(url, method="GET", headers={"User-Agent": "YoohDesktop/1.0"})
        with urlopen(request, timeout=timeout):
            return True
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False
    except Exception:
        return False


def resolve_start_url(config: AppConfig) -> str:
    if is_url_reachable(config.start_url):
        return config.start_url
    if config.fallback_url and is_url_reachable(config.fallback_url):
        return config.fallback_url
    return config.start_url


def with_launch_nonce(url: str) -> str:
    try:
        parsed = urlparse(url)
        query = parse_qsl(parsed.query, keep_blank_values=True)
        query = [(k, v) for k, v in query if k not in {"desktop_launch", "desktop_app"}]
        query.append(("desktop_launch", str(int(time.time() * 1000))))
        query.append(("desktop_app", "native"))
        return urlunparse(parsed._replace(query=urlencode(query)))
    except Exception:
        return url


def apply_session_state_to_url(url: str, session_state: dict[str, str]) -> str:
    try:
        parsed = urlparse(url)
        query = parse_qsl(parsed.query, keep_blank_values=True)
        query = [(k, v) for k, v in query if k not in {"desktop_token", "desktop_lang", "desktop_platform"}]
        if session_state.get("token"):
            query.append(("desktop_token", session_state["token"]))
        if session_state.get("lang"):
            query.append(("desktop_lang", session_state["lang"]))
        if session_state.get("platform"):
            query.append(("desktop_platform", session_state["platform"]))
        return urlunparse(parsed._replace(query=urlencode(query)))
    except Exception:
        return url


def capture_window_session_state(window: Any) -> None:
    try:
        result = window.evaluate_js(
            """
            (() => JSON.stringify({
              token: localStorage.getItem('yooh_token') || '',
              lang: localStorage.getItem('yooh_lang') || '',
              platform: localStorage.getItem('yooh_platform') || ''
            }))()
            """
        )
    except Exception:
        return

    payload: dict[str, Any] = {}
    if isinstance(result, str):
        try:
            payload = json.loads(result)
        except Exception:
            payload = {}
    elif isinstance(result, dict):
        payload = result
    if isinstance(payload, dict):
        try:
            save_session_state(payload)
        except Exception:
            pass


def inject_update_watcher(window: Any, poll_seconds: int) -> None:
    poll_ms = max(5000, int(poll_seconds) * 1000)
    script = f"""
      (function () {{
        if (window.__yoohDesktopUpdateWatcherInstalled) return;
        window.__yoohDesktopUpdateWatcherInstalled = true;
        const endpoint = '/api/app-version';
        const pollMs = {poll_ms};
        let runtimeId = null;
        async function checkVersion() {{
          try {{
            const response = await fetch(endpoint, {{ cache: 'no-store' }});
            if (!response.ok) return;
            const payload = await response.json();
            const nextId = String(payload?.runtimeId || '');
            if (!nextId) return;
            if (runtimeId && nextId !== runtimeId) {{
              window.location.reload();
              return;
            }}
            runtimeId = nextId;
          }} catch (_err) {{
            // Ignore polling errors and retry.
          }}
        }}
        checkVersion();
        setInterval(checkVersion, pollMs);
      }})();
    """
    try:
        window.evaluate_js(script)
    except Exception:
        pass


def load_tray_image() -> Any:
    if Image is None:
        return None

    primary = get_bundle_root() / "icons" / "icon-192.png"
    fallback = get_bundle_root() / "src" / "client" / "icons" / "icon-192.png"
    image_path = primary if primary.exists() else fallback
    if image_path.exists():
        return Image.open(image_path).convert("RGBA")

    image = Image.new("RGBA", (128, 128), (24, 110, 210, 255))
    draw = ImageDraw.Draw(image)
    draw.ellipse((6, 6, 122, 122), fill=(67, 156, 246, 255))
    draw.text((49, 38), "Y", fill=(255, 255, 255, 255))
    return image


class TrayBridge:
    def __init__(self, app_name: str, enabled: bool) -> None:
        self.app_name = app_name
        self.enabled = bool(enabled and pystray is not None and Image is not None)
        self.icon: Any = None
        self.thread: threading.Thread | None = None
        self.window: Any = None
        self.quit_requested = False
        self.started = False

    def bind_window(self, window: Any) -> None:
        self.window = window

    def should_minimize_to_tray(self) -> bool:
        return self.enabled and self.started and not self.quit_requested

    def start(self) -> None:
        if not self.enabled:
            return
        try:
            menu = pystray.Menu(
                pystray.MenuItem("Open Yooh", self._on_open),
                pystray.MenuItem("Exit", self._on_exit),
            )
            self.icon = pystray.Icon("yooh", load_tray_image(), self.app_name, menu)
            self.thread = threading.Thread(target=self.icon.run, name="yooh-tray", daemon=True)
            self.thread.start()
            self.started = True
        except Exception:
            # If tray failed to initialize, do not block normal app closing.
            self.enabled = False
            self.started = False

    def stop(self) -> None:
        if self.icon:
            self.icon.stop()
            self.icon = None
        self.started = False

    def _on_open(self, *_args: Any) -> None:
        if not self.window:
            return
        try:
            self.window.restore()
            self.window.show()
        except Exception:
            pass

    def _on_exit(self, *_args: Any) -> None:
        self.quit_requested = True
        if self.window:
            try:
                capture_window_session_state(self.window)
            except Exception:
                pass
            try:
                self.window.destroy()
            except Exception:
                pass
        self.stop()

    def minimize_to_tray(self) -> bool:
        if not self.window:
            return False
        succeeded = False
        try:
            self.window.hide()
            succeeded = True
        except Exception:
            pass
        if not succeeded:
            try:
                if hasattr(self.window, "minimize"):
                    self.window.minimize()
                    succeeded = True
            except Exception:
                pass
        return succeeded


class DesktopBridge:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.main_window: Any = None

    def bind_window(self, window: Any) -> None:
        self.main_window = window

    def open_youtube(self) -> dict[str, Any]:
        self._launch_youtube_vpn()
        title = "YouTube"
        html = """
          <!doctype html>
          <html lang="en">
            <meta charset="utf-8" />
            <title>YouTube</title>
            <style>
              body{margin:0;background:#0b0b0d;color:#fff;font:16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;place-items:center;height:100vh}
              .card{padding:24px 28px;border-radius:18px;background:#17171b;box-shadow:0 18px 48px rgba(0,0,0,.35);text-align:center}
              .hint{color:#b9c0cb;margin-top:8px}
            </style>
            <body>
              <div class="card">
                <h1 style="margin:0 0 8px;font-size:22px">YouTube</h1>
                <div>Launching VPN and opening YouTube...</div>
                <div class="hint">If the page loads slowly, wait a few seconds for the connection.</div>
              </div>
            </body>
          </html>
        """
        window = webview.create_window(
            title=title,
            html=html,
            width=max(1180, self.config.window_width),
            height=max(760, self.config.window_height),
            min_size=(980, 700),
            background_color="#0b0b0d",
        )

        def open_youtube_url() -> None:
            time.sleep(3)
            try:
                window.load_url(YOUTUBE_URL)
            except Exception:
                pass

        threading.Thread(target=open_youtube_url, name="yooh-youtube-launch", daemon=True).start()
        return {"ok": True}

    def _launch_youtube_vpn(self) -> None:
        try:
            subprocess.Popen(
                ["cmd.exe", "/c", "start", "", str(YOUTUBE_VPN_SCRIPT)],
                cwd=str(YOUTUBE_VPN_SCRIPT.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
        except Exception:
            # Ignore VPN launcher failures and still try to open YouTube.
            pass


def main() -> None:
    config = resolve_config()
    if "--check-config" in sys.argv:
        print(json.dumps(config.__dict__, ensure_ascii=False, indent=2))
        print(f"resolved_start_url={resolve_start_url(config)}")
        return

    selected_url = with_launch_nonce(apply_session_state_to_url(resolve_start_url(config), load_session_state()))
    tray = TrayBridge(config.app_name, config.close_to_tray)
    bridge = DesktopBridge(config)
    window = webview.create_window(
        title=config.app_name,
        url=selected_url,
        width=config.window_width,
        height=config.window_height,
        min_size=(config.window_min_width, config.window_min_height),
        background_color="#0b1f36",
        js_api=bridge,
    )
    tray.bind_window(window)
    bridge.bind_window(window)

    def on_window_closing() -> bool:
        if tray.should_minimize_to_tray():
            if tray.minimize_to_tray():
                return False
        capture_window_session_state(window)
        return True

    window.events.closing += on_window_closing
    def on_window_loaded() -> None:
        capture_window_session_state(window)
        if config.auto_reload_on_server_update:
            inject_update_watcher(window, config.version_poll_seconds)

    window.events.loaded += on_window_loaded
    tray.start()

    webview.start(debug=bool(os.getenv("YOOH_DESKTOP_DEBUG")), gui="edgechromium")
    tray.stop()


if __name__ == "__main__":
    main()
