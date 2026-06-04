// Full-page screenshot of the local portfolio with reduced-motion emulation
// (so scroll-reveal elements are visible without scrolling). For QA only.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "http://localhost:8755/";
const out = process.argv[3] || "/tmp/pf-verify.png";
const PORT = 9711;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, "--window-size=1280,1000",
  "--user-data-dir=/tmp/cdp-verify", "about:blank",
], { stdio: "ignore" });

async function pageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error("no page target");
}

(async () => {
  const ws = new WebSocket(await pageWs());
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? {}); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.navigate", { url });
  await sleep(2500);
  // scroll through the page to trigger lazy-loaded images, then return to top
  await send("Runtime.evaluate", { expression: `(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,90));}window.scrollTo(0,0);})()`, awaitPromise: true });
  await sleep(1200);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out);
  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
