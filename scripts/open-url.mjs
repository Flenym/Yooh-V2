import { spawn } from "node:child_process";

const urls = process.argv.slice(2);
if (!urls.length) {
  process.exit(0);
}

function openUrl(url) {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  }

  if (process.platform === "darwin") {
    return spawn("open", [url], { detached: true, stdio: "ignore" });
  }

  return spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

for (const url of urls) {
  const child = openUrl(url);
  child.unref();
}
