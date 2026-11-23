import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("shots");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const profile = path.join(process.env.TEMP, "aurum-shots-profile");

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--window-size=1600,1000",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("chrome did not start");
}

const ws = new WebSocket(await getWs());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://localhost:3000" });
await sleep(9000);

const click = (text) =>
  evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}));if(!b)return false;b.click();return true})()`);

async function shot(name, wait = 1800) {
  await sleep(wait);
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
  console.log("saved", name);
}

await shot("terminal", 500);
await click("AI Desk");
await sleep(500);
await evalJs(`(()=>{const i=document.querySelector('input[placeholder^="Ask or command"]');return !!i})()`);
await shot("aidesk");
await click("Strategy");
await shot("strategy");
await click("Backtest");
await shot("backtest", 6000);
await click("Revenue");
await shot("revenue");
await click("News/FX");
await shot("intel");
await click("Client Hub");
await shot("hub_health");
await click("Client Reports");
await shot("hub_reports");
await click("Trading Mandate");
await shot("hub_mandate");
await click("MT5/Risk");
await shot("bridge");

ws.close();
chrome.kill();
process.exit(0);
