import puppeteer from "/Users/tyler/Developer/gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const browser = await puppeteer.launch({ headless: "new", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=metal", "--enable-gpu", "--no-sandbox"] });
async function run(name, { viewport, js = true, saveData = false, act }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setJavaScriptEnabled(js);
  if (saveData) await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, "connection", { get: () => ({ saveData: true, effectiveType: "4g" }) }); });
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.goto("http://localhost:8788/earth", { waitUntil: "domcontentloaded" });
  if (js && !saveData) await page.waitForFunction(() => document.documentElement.getAttribute("data-globe") === "ready", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  if (act) await act(page);
  const info = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, globe: document.documentElement.getAttribute("data-globe"), items: document.querySelectorAll("#signalList li").length }));
  await page.screenshot({ path: `work/${name}.png` });
  console.log(name, JSON.stringify(info), "maplibre requested:", reqs.some((u) => /maplibre|gibs/.test(u)));
  await page.close();
}
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
await run("nojs-desktop", { viewport: desktop, js: false });
await run("nojs-phone", { viewport: phone, js: false });
await run("lowpower-phone", { viewport: phone, saveData: true });
await run("detail-desktop", { viewport: desktop, act: async (p) => { await p.evaluate(() => document.querySelector("#signalList .signal").click()); await new Promise((r) => setTimeout(r, 3500)); } });
await run("detail-phone", { viewport: phone, act: async (p) => { await p.evaluate(() => document.querySelector("#signalList .signal").click()); await new Promise((r) => setTimeout(r, 3500)); } });
await run("filter-earthquake-24h", { viewport: desktop, act: async (p) => { await p.evaluate(() => { document.querySelector('[data-window="24h"]').click(); document.querySelector('[data-hazard="earthquake"]').click(); }); await new Promise((r) => setTimeout(r, 2500)); } });
await browser.close();
