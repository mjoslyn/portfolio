// Screenshot a page after removing popups/overlays, via the Chrome DevTools
// Protocol (uses Node's global WebSocket — Node 22+). Usage:
//   node scripts/shot.mjs <url> <out.png> [width] [height]

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [url, out, w = "1366", h = "854"] = process.argv.slice(2);
const WIDTH = Number(w), HEIGHT = Number(h);
const PORT = 9222 + Math.floor((Date.now() % 500));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "--user-data-dir=/tmp/cdp-profile-" + PORT,
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

const KILL_OVERLAYS = `
(() => {
  const isOverlay = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const s = getComputedStyle(el);
    const z = parseInt(s.zIndex) || 0;
    const positioned = s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky';
    return positioned && z >= 50;
  };
  const kill = () => {
    // 1) whatever sits at the center of the viewport, if it's a floating layer, goes
    for (let pass = 0; pass < 6; pass++) {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (!el) break;
      let node = el, target = null;
      while (node && node !== document.body) {
        if (isOverlay(node)) target = node;
        node = node.parentElement;
      }
      if (!target) break;
      target.remove();
    }
    // 2) explicit close buttons + known backdrops
    document.querySelectorAll(
      '[class*="close" i],[id*="close" i],[aria-label*="close" i],[class*="dismiss" i],' +
      '.modal-backdrop,.pum-overlay,.mfp-bg,.ctct-form-popup-close'
    ).forEach(e => { try { e.click && e.click(); } catch(_){} });
    // 3) large fixed/absolute iframes (3rd-party popups)
    document.querySelectorAll('iframe').forEach(f => {
      const r = f.getBoundingClientRect();
      if (r.width > innerWidth * 0.4 && r.height > innerHeight * 0.4) f.remove();
    });
    // 4) unlock scroll
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.position = 'static';
  };
  kill(); setTimeout(kill, 500); setTimeout(kill, 1200);
})();
`;

(async () => {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  const send = cdp(ws);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(6500); // let hero assets + fonts settle
  await send("Runtime.evaluate", { expression: KILL_OVERLAYS });
  await sleep(1700); // let the staged removals repaint
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out);
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
