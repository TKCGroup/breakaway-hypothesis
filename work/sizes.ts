import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { earthWatchHtml } from "../src/earth.js";
import { earthGlobeHtml } from "../src/earthGlobe.js";
const gz = (b: Buffer | string) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b: Buffer | string) => zlib.brotliCompressSync(b).length;
function inline(html: string) {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
}
for (const [name, html] of [["OLD /earth (leaflet+three)", earthWatchHtml()], ["NEW /earth (maplibre)", earthGlobeHtml()]] as const) {
  const js = inline(html);
  console.log(name, JSON.stringify({ htmlRaw: html.length, htmlGz: gz(html), inlineJsRaw: js.length, inlineJsGz: gz(js), inlineJsBr: br(js) }));
}
const three = ["three.module.min.js", "three.core.min.js"].map((f) => readFileSync("node_modules/three/build/" + f));
console.log("three (both, eager module):", JSON.stringify({ raw: three.reduce((n, b) => n + b.length, 0), gz: three.reduce((n, b) => n + gz(b), 0), br: three.reduce((n, b) => n + br(b), 0) }));
