// Render the social share card (assets/share-card.html) to a 1200x630 PNG
// via the Chrome DevTools Protocol. Run gen-share-bg.mjs first for the
// psychedelic backdrop. Usage: node scripts/gen-share.mjs

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CARD = "file://" + resolve("assets/share-card.html");
const OUT = "assets/img/share-card.png";
const WIDTH = 1200, HEIGHT = 630, SCALE = 2; // 2x for crisp text
const PORT = 9222 + Math.floor((Date.now() % 500));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "--user-data-dir=/tmp/cdp-share-" + PORT,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error("Chrome page target never came up");
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      if (m.error) console.error("CDP error", m.method, m.error);
      pending.get(m.id)(m.result ?? {});
      pending.delete(m.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
}

(async () => {
  const ws = new WebSocket(await getWsUrl());
  await new Promise((r) => (ws.onopen = r));
  const send = cdp(ws);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false,
  });
  await send("Page.navigate", { url: CARD });
  await sleep(4500); // let web fonts + backdrop load
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 }, // deviceScaleFactor already 2x
  });
  writeFileSync(OUT, Buffer.from(data, "base64"));
  console.log("wrote", OUT);
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
