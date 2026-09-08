const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const APP_URL = process.env.YOOH_URL || "http://localhost:4200";
const APP_NAME = "Yooh";
const APP_ORIGIN = (() => {
  try {
    return new URL(APP_URL).origin;
  } catch {
    return "http://localhost:4200";
  }
})();
const DESKTOP_YOUTUBE_PATH = "/__desktop/youtube";
const DESKTOP_YOUTUBE_URL = "https://www.youtube.com";
const DESKTOP_YOUTUBE_VPN_SCRIPT =
  process.env.YOOH_YOUTUBE_VPN_SCRIPT || String.raw`C:\Users\ignat\OneDrive\Рабочий стол\zapret\general (ALT11).bat`;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hideToTrayPending = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}
app.commandLine.appendSwitch("disable-hang-monitor");

function buildTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#12263a"/>
      <circle cx="32" cy="32" r="20" fill="#4aa3ff"/>
      <path d="M22 24h20v12c0 5.2-4.8 9-10 9h-2l-7 5v-7.2c-0.6-1-1-2.2-1-3.6z" fill="#ffffff"/>
    </svg>
  `;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`);
  return icon.resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (hideToTrayPending || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  hideToTrayPending = true;
  setImmediate(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      hideToTrayPending = false;
      return;
    }
    mainWindow.setSkipTaskbar(true);
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    }
    hideToTrayPending = false;
  });
}

function createTray() {
  if (tray) {
    return;
  }
  tray = new Tray(buildTrayIcon());
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Yooh",
        click: () => {
          showMainWindow();
        },
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          isQuitting = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(false);
            mainWindow.close();
          } else {
            app.quit();
          }
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    showMainWindow();
  });
}

function launchDesktopYoutubeVpn() {
  try {
    spawn("cmd.exe", ["/c", "start", "", DESKTOP_YOUTUBE_VPN_SCRIPT], {
      cwd: path.dirname(DESKTOP_YOUTUBE_VPN_SCRIPT),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
  } catch {
    // Ignore VPN launcher failures and still try to open YouTube.
  }
}

function openDesktopYoutubeWindow(parentWindow = null) {
  launchDesktopYoutubeVpn();
  const youtubeWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "YouTube",
    show: false,
    backgroundColor: "#0b0b0d",
    parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  youtubeWindow.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(`
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
    `)}`,
  );
  youtubeWindow.once("ready-to-show", () => {
    youtubeWindow.show();
  });
  setTimeout(() => {
    if (!youtubeWindow.isDestroyed()) {
      youtubeWindow.loadURL(DESKTOP_YOUTUBE_URL).catch(() => {
        // Ignore external load failures.
      });
    }
  }, 3000);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    title: APP_NAME,
    show: false,
    backgroundColor: "#0f1b2b",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const applyDesktopZoom = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    try {
      mainWindow.webContents.setZoomFactor(1);
      mainWindow.webContents.setZoomLevel(0);
      mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    } catch {
      // Ignore unsupported zoom lock failures on older runtimes.
    }
  };

  const baseUserAgent = mainWindow.webContents.getUserAgent();
  const appVersion = typeof app.getVersion === "function" ? app.getVersion() : "1.0.0";
  mainWindow.webContents.setUserAgent(`${baseUserAgent} YoohDesktop/${appVersion}`);
  const bootUrl = new URL(APP_URL);
  bootUrl.searchParams.set("desktop_app", "electron");
  mainWindow.loadURL(bootUrl.toString());
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.show();
  });

  mainWindow.webContents.on("did-finish-load", applyDesktopZoom);
  mainWindow.webContents.on("zoom-changed", applyDesktopZoom);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!(input?.control || input?.meta)) {
      return;
    }
    const key = String(input.key || "").toLowerCase();
    if (!["+", "=", "-", "_", "0"].includes(key)) {
      return;
    }
    event.preventDefault();
    applyDesktopZoom();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (String(url || "").startsWith(`${APP_ORIGIN}${DESKTOP_YOUTUBE_PATH}`)) {
      openDesktopYoutubeWindow(mainWindow);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.setSkipTaskbar(false);
  });

  mainWindow.on("hide", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.setSkipTaskbar(true);
  });

  mainWindow.on("minimize", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    hideToTray();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    setImmediate(() => {
      hideToTray();
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_NAME);
  createTray();
  createMainWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    showMainWindow();
  });
});

app.on("second-instance", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", (event) => {
  if (!isQuitting && process.platform !== "darwin") {
    event.preventDefault();
  }
});
