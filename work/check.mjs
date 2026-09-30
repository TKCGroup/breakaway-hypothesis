// Headless Chrome check of the globe page against work/serve.ts.
// usage: node work/check.mjs <desktop|phone> [name] [--layers]
import puppeteer from "/Users/tyler/Developer/gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const mode = process.argv[2] || "desktop";
const name = process.argv[3] || mode;
const layers = process.argv.includes("--layers");
const viewport = mode === "phone" ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 };
const browser = await puppeteer.launch({
  headless: "new",
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-angle=metal", "--enable-gpu", "--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport(viewport);
const errors = [];
const requests = [];
let bytes = 0;
const sizes = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text().slice(0, 240)); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 300)));
page.on("response", async (r) => {
  const url = r.url();
  const len = Number(r.headers()["content-length"] || 0);
  requests.push({ url: url.replace(/\?.*/, "").slice(0, 110), status: r.status(), len });
});
const client = await page.createCDPSession();
await client.send("Network.enable");
client.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; });
const t0 = Date.now();
await page.goto("http://localhost:8788/earth", { waitUntil: "domcontentloaded" });
const tDom = Date.now() - t0;
await page.waitForFunction(() => document.documentElement.getAttribute("data-globe") === "ready", { timeout: 60000 }).catch(() => {});
const tReady = Date.now() - t0;
await new Promise((r) => setTimeout(r, 3500));
if (layers) {
  await page.evaluate(() => { document.getElementById("layersToggle").click(); });
  for (const id of ["tAurora", "tSpc", "tPorts"]) await page.evaluate((i) => document.getElementById(i).click(), id);
  await new Promise((r) => setTimeout(r, 6000));
}
const metrics = await page.evaluate(() => ({
  globe: document.documentElement.getAttribute("data-globe"),
  scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  bodyScrollW: document.body.scrollWidth,
  signals: document.querySelectorAll("#signalList .signal").length,
  pills: document.querySelectorAll("#pills .pill").length,
  chip: document.getElementById("postureChip").textContent,
  fresh: document.getElementById("fresh").textContent,
  status: document.getElementById("status").textContent,
  auroraStatus: document.getElementById("auroraStatus").textContent,
  spcStatus: document.getElementById("spcStatus").textContent,
  portsStatus: document.getElementById("portsStatus").textContent,
  focus: document.getElementById("mapFocus").textContent,
  timing: (() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; })(),
  fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime,
}));
await page.screenshot({ path: `work/${name}.png` });
console.log(JSON.stringify({ mode, tDom, tReady, transferKB: Math.round(bytes / 1024), ...metrics }, null, 1));
const js = requests.filter((r) => /\.js$|maplibre/.test(r.url));
console.log("js requests", js);
console.log("origins", [...new Set(requests.map((r) => new URL(r.url).origin))]);
console.log("errors", errors.slice(0, 12));
await browser.close();
