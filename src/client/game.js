const statusNode = document.getElementById("game-status");
const frame = document.getElementById("game-mode-iframe");
const overlayNode = document.getElementById("game-overlay");
const legacyBackButton = document.getElementById("back-to-chat-btn");
const playmodeBase = String(frame?.dataset?.playmodeSrc || "/playmode/").trim() || "/playmode/";

function setStatus(message, isError = false) {
  if (overlayNode) {
    const text = String(message || "").trim();
    if (text) {
      overlayNode.textContent = text;
      overlayNode.classList.remove("hidden");
    } else {
      overlayNode.classList.add("hidden");
    }
  }

  if (!statusNode) {
    if (isError) {
      console.error(String(message || ""));
    } else {
      console.info(String(message || ""));
    }
    return;
  }
  statusNode.textContent = String(message || "");
  statusNode.classList.toggle("error", Boolean(isError));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestPlaymodeSession(mainToken) {
  const response = await fetchWithTimeout(
    "/api/playmode/session",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mainToken}`,
      },
      body: "{}",
    },
    15000,
  );

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Response can be empty/non-JSON on transient proxy issues.
  }

  if (!response.ok) {
    throw new Error(payload.error || `Session sync failed (${response.status})`);
  }

  const token = String(payload.token || "").trim();
  if (!token) {
    throw new Error("Playmode token is missing");
  }

  return token;
}

async function requestPlaymodeSessionWithRetry(mainToken, attempts = 3) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await requestPlaymodeSession(mainToken);
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        setStatus(`Retrying game mode connection (${index + 2}/${attempts})...`);
        await wait(900);
      }
    }
  }
  throw lastError ?? new Error("Game mode connection failed");
}

async function bootstrap() {
  if (!frame) {
    setStatus("Game mode container is missing.", true);
    return;
  }

  const mainToken = String(localStorage.getItem("yooh_token") || "").trim();
  if (!mainToken) {
    setStatus("Main Yooh session is missing. Log in to chats first.", true);
    frame.src = "about:blank";
    return;
  }

  try {
    setStatus("Syncing game mode...");
    const playmodeToken = await requestPlaymodeSessionWithRetry(mainToken, 3);

    localStorage.setItem("yooh_main_token", mainToken);
    localStorage.setItem("yooh_playmode_token", playmodeToken);

    frame.src = `${playmodeBase}?session=${Date.now()}`;
    setStatus("");
  } catch (error) {
    const message = error && error.name === "AbortError"
      ? "Playmode session timeout. Check backend and retry."
      : error && error.message
        ? error.message
        : "Game mode connection error.";
    setStatus(message, true);
    frame.src = "about:blank";
  }
}

legacyBackButton?.addEventListener("click", () => {
  window.location.assign("/");
});

bootstrap();
