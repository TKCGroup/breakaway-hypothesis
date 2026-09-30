import puppeteer from "/Users/tyler/Developer/gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
import zlib from "node:zlib";
const browser = await puppeteer.launch({ headless: "new", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=metal", "--enable-gpu", "--no-sandbox"] });
async function measure(path, label, viewport, readyFn) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  const types = {};
  const meta = new Map();
  client.on("Network.responseReceived", (e) => meta.set(e.requestId, { type: e.type, url: e.response.url, enc: e.response.headers["content-encoding"] }));
  client.on("Network.loadingFinished", (e) => {
    const m = meta.get(e.requestId); if (!m) return;
    const t = m.type + (/localhost/.test(m.url) ? "" : "*");
    types[t] = (types[t] || 0) + e.encodedDataLength;
    if (m.type === "Script") (types._scripts ||= []).push([m.url.slice(0, 70), e.encodedDataLength]);
  });
  const t0 = Date.now();
  await page.goto("http://localhost:8788" + path, { waitUntil: "load" });
  const load = Date.now() - t0;
  await page.waitForFunction(readyFn, { timeout: 90000 }).catch(() => {});
  const ready = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  const heap = await page.metrics();
  const fcp = await page.evaluate(() => (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime);
  const inline = await page.evaluate(() => [...document.scripts].filter((s) => !s.src).reduce((n, s) => n + s.text.length, 0));
  console.log(label, JSON.stringify({ load, ready, fcp: Math.round(fcp), inlineJsBytes: inline, jsHeapMB: Math.round(heap.JSHeapUsedSize / 1e5) / 10, transferKB: Object.fromEntries(Object.entries(types).filter(([k]) => k[0] !== "_").map(([k, v]) => [k, Math.round(v / 1024)])), scripts: types._scripts }));
  await page.close();
}
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
for (const [name, vp] of [["desktop", desktop], ["phone", phone]]) {
  await measure("/earth", "NEW " + name, vp, () => document.documentElement.getAttribute("data-globe") === "ready");
  await measure("/classic", "OLD " + name, vp, () => document.getElementById("fresh") && /Updated/.test(document.getElementById("fresh").textContent));
}
await browser.close();
