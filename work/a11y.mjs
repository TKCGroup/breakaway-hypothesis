import puppeteer from "/Users/tyler/Developer/gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const browser = await puppeteer.launch({ headless: "new", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=metal", "--enable-gpu", "--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto("http://localhost:8788/earth", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.documentElement.getAttribute("data-globe") === "ready", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => document.getElementById("layersToggle").click());
const snap = await page.accessibility.snapshot({ interestingOnly: true });
const bad = [];
let count = 0;
(function walk(n) {
  if (["button", "link", "checkbox", "combobox", "textbox", "listbox", "application"].includes(n.role)) { count++; if (!n.name || !n.name.trim()) bad.push(n.role + " (unnamed)"); }
  (n.children || []).forEach(walk);
})(snap);
console.log("interactive nodes:", count, "unnamed:", bad);
const landmarks = await page.evaluate(() => ({ h1: document.querySelectorAll("h1").length, banner: !!document.querySelector("header"), contentinfo: !!document.querySelector("footer"), sectionsLabelled: [...document.querySelectorAll("section")].every((s) => s.getAttribute("aria-label") || s.getAttribute("aria-labelledby")), lang: document.documentElement.lang }));
console.log(landmarks);
// keyboard: tab through first 12 stops and print what receives focus
const stops = [];
for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); stops.push(await page.evaluate(() => { const a = document.activeElement; return (a.id || a.getAttribute("aria-label") || a.textContent || a.tagName).trim().slice(0, 30); })); }
console.log("tab order:", stops.join(" > "));
// escape closes the detail card
await page.evaluate(() => document.querySelector("#signalList .signal").click());
await new Promise((r) => setTimeout(r, 1200));
const focused = await page.evaluate(() => document.activeElement.id);
await page.keyboard.press("Escape");
console.log("focus moved to detail title:", focused, "| closed on Escape:", await page.evaluate(() => document.getElementById("detail").hidden));
await browser.close();
