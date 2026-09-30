// Local harness: serves the globe page with its real CSP, and proxies GET /api/earth
// from the public site (read-only) so the page has live data. Not part of the build.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { earthWatchHtml } from "../src/earth.js";
import { earthGlobeContentSecurityPolicy, earthGlobeHtml } from "../src/earthGlobe.js";

let cached: { at: number; body: string } | null = null;
async function earth(): Promise<string> {
  if (cached && Date.now() - cached.at < 300_000) return cached.body;
  const response = await fetch("https://earth.tkcgroup.co/api/earth");
  const body = await response.text();
  cached = { at: Date.now(), body };
  return body;
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path === "/api/earth") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(await earth());
    return;
  }
  if (path === "/" || path === "/earth") {
    let data = null;
    try { data = JSON.parse(await earth()); } catch {}
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": earthGlobeContentSecurityPolicy() });
    res.end(earthGlobeHtml({ data }));
    return;
  }
  if (path === "/classic") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(earthWatchHtml());
    return;
  }
  const three = path.match(/^\/assets\/three-0\.180\.0\/(three\.module\.js|three\.core\.min\.js)$/);
  if (three) {
    const file = three[1] === "three.module.js" ? "three.module.min.js" : "three.core.min.js";
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-encoding": "identity" });
    res.end(await readFile(new URL("../node_modules/three/build/" + file, import.meta.url)));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(8788, () => console.log("listening 8788"));
