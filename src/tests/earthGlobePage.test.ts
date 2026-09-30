import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildEarthWatchData } from "../earth.js";
import {
  GLOBE_ORIGINS,
  MAPLIBRE,
  earthGlobeContentSecurityPolicy,
  earthGlobeHtml,
  renderSignalListHtml,
} from "../earthGlobe.js";
import { earthFiltersClientSource } from "../logic/earthFilters.js";
import { ambientClientSource } from "../logic/ambient.js";
import { solarClientSource } from "../logic/solar.js";
import { DEFAULT_CONFIG } from "../config.js";
import type { DashboardSnapshot } from "../dashboard.js";
import { createWatcherServer } from "../server.js";
import { eventFixture, NOW } from "./helpers.js";

/**
 * The globe page's behaviour lives in a serialised function, where a stray backtick,
 * an unbalanced brace or a stale element id produces a page that compiles, deploys
 * and renders dead. These tests parse and cross-check what is actually shipped.
 */

const html = earthGlobeHtml();

function scriptBodies(): string[] {
  const out: string[] = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let match = pattern.exec(html);
  while (match) {
    if (!/\ssrc=/.test(match[1])) out.push(match[2]);
    match = pattern.exec(html);
  }
  return out;
}

describe("earthGlobeHtml script integrity", () => {
  it("parses every inline script as JavaScript", () => {
    const bodies = scriptBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) expect(() => new vm.Script(body)).not.toThrow();
  });

  it("is a complete document with no backtick and no early script terminator", () => {
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).not.toContain("`");
    expect(html.match(/<\/script>/g)?.length).toBe(
      html.match(/<script/g)?.length,
    );
  });

  it("embeds the shared rules verbatim rather than a second copy", () => {
    for (const source of [
      solarClientSource(),
      ambientClientSource(),
      earthFiltersClientSource(),
    ]) {
      for (const line of source.split("\n")) expect(html).toContain(line);
    }
  });

  it("reads every element id it looks up from markup that declares it", () => {
    const declared = new Set<string>();
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) declared.add(m[1]);
    const lookups = new Set<string>();
    for (const body of scriptBodies()) {
      for (const m of body.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g))
        lookups.add(m[1]);
      for (const m of body.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g))
        lookups.add(m[1]);
    }
    expect(lookups.size).toBeGreaterThan(20);
    const missing = [...lookups].filter((id) => !declared.has(id));
    expect(missing).toEqual([]);
  });
});

describe("earthGlobeHtml accessibility and fallback", () => {
  it("has landmarks, a skip link, live regions and labelled controls", () => {
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('<a class="skip" href="#signals">');
    expect(html).toContain("<header");
    expect(html).toContain('<section class="stage"');
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="error" role="alert"/);
    expect(html).toContain('aria-label="Filter by hazard family"');
    expect(html).toContain('id="globe" role="application" tabindex="0"');
  });

  it("keeps the signal list as plain HTML, visible without JavaScript", () => {
    expect(html).toMatch(/<ol class="list" id="signalList">/);
    expect(html).toMatch(/html:not\(\.js\) \.stage/);
    // The globe container must not be the only carrier of information.
    expect(html).toContain("Every event is also in the signal list");
  });

  it("offers a low-power path that skips the map engine", () => {
    expect(html).toContain("lowPowerReason");
    expect(html).toContain("Load the globe anyway");
    expect(html).toContain("saveData");
    expect(html).toContain("prefers-reduced-data");
  });

  it("honours reduced motion for the spin and the fly-to", () => {
    expect(html).toContain("prefers-reduced-motion: reduce");
    expect(html).toContain("jumpTo");
  });
});

describe("earthGlobeHtml keeps its claims honest", () => {
  it("says it is not a prediction or emergency-warning service", () => {
    expect(html).toContain("Not a prediction or emergency-warning service");
  });

  it("says a failed feed is not an all-clear", () => {
    expect(html).toContain("Do not interpret this as a clear reading");
    expect(html).toContain("This is not an all-clear");
  });

  it("credits every source it draws from", () => {
    for (const credit of [
      "NASA GIBS",
      "IMF PortWatch",
      "NOAA/NWS Storm Prediction Center",
      "USGS",
      "MapLibre GL JS",
      "GeoNames",
    ]) {
      expect(html).toContain(credit);
    }
    expect(MAPLIBRE.js).toContain("maplibre-gl@5.24.0");
  });

  it("never puts a raw url in an href without the https check", () => {
    const client = scriptBodies().join("\n");
    expect(client).toContain('url.protocol === "https:"');
    expect(client).not.toMatch(/href="' \+ event\.officialUrl/);
  });

  it("does not carry any non-public layer", () => {
    const client = scriptBodies().join("\n").toLowerCase();
    for (const banned of [
      "cctv",
      "alpr",
      "license plate",
      "plate reader",
      "military",
      "opensky",
      "adsb",
      "flightradar",
      "aisstream",
      "openai",
      "webrtc",
      "radio-browser",
      "googleapis.com/maps",
      "api_key",
      "apikey",
      "access_token",
    ]) {
      expect(client, `banned term ${banned}`).not.toContain(banned);
    }
  });

  it("only contacts origins that are listed in GLOBE_ORIGINS", () => {
    const client = scriptBodies().join("\n") + MAPLIBRE.js + MAPLIBRE.css;
    const allowed = new Set(
      [
        ...GLOBE_ORIGINS.scriptAndStyle,
        ...GLOBE_ORIGINS.connectAndImage,
        ...GLOBE_ORIGINS.connect,
      ].map((o) => new URL(o).host),
    );
    // Hosts that appear as outbound links only (an anchor a reader may click), not fetches.
    const linkOnly = new Set([
      "forecast.weather.gov",
      "www.swpc.noaa.gov",
      "www.tsunami.gov",
      "portwatch.imf.org",
      "earth.tkcgroup.co",
      "maplibre.org",
      "earthdata.nasa.gov",
    ]);
    const hosts = new Set<string>();
    for (const m of client.matchAll(/https:\/\/([a-z0-9.-]+)/gi))
      hosts.add(m[1].toLowerCase());
    const stray = [...hosts].filter((h) => !allowed.has(h) && !linkOnly.has(h));
    expect(stray).toEqual([]);
  });
});

describe("earthGlobeContentSecurityPolicy", () => {
  const csp = earthGlobeContentSecurityPolicy();
  const directive = (name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + " "))
      ?.split(/\s+/)
      .slice(1) ?? [];

  it("allows the tile, data and worker origins the globe needs and nothing broader", () => {
    expect(directive("connect-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://gibs.earthdata.nasa.gov",
        "https://services.swpc.noaa.gov",
        "https://www.spc.noaa.gov",
        "https://services9.arcgis.com",
      ]),
    );
    expect(directive("img-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "data:",
        "blob:",
        "https://gibs.earthdata.nasa.gov",
      ]),
    );
    expect(directive("worker-src")).toEqual(["blob:"]);
    expect(directive("script-src")).toContain("https://unpkg.com");
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("https://evil");
  });

  it("no longer needs the old page's map, font or per-hazard origins", () => {
    for (const gone of [
      "cartocdn",
      "nationalmap.gov",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "api.weather.gov",
      "ngdc.noaa.gov",
      "earthquake.usgs.gov",
    ]) {
      expect(csp).not.toContain(gone);
    }
  });
});

describe("the server-rendered signal list", () => {
  // The stale gate refuses non-official URLs upstream, so a hostile link cannot arrive
  // through the builder; the renderer must still refuse it if one ever did.
  const data = buildEarthWatchData(
    {
      events: [
        eventFixture({
          id: "e1",
          externalId: "us7000aaa1",
          lat: 10,
          lon: 20,
          title: "M 6.1 - <b>Test</b> & Co",
          magnitude: 6.1,
          eventTime: new Date(NOW.getTime() - 600_000),
        }),
        eventFixture({
          id: "e2",
          externalId: "us7000bbb2",
          lat: -30,
          lon: 140,
          title: "Odd link",
          eventTime: new Date(NOW.getTime() - 600_000),
        }),
      ],
      cascadeStates: [],
      sourceRuns: [],
      notifications: [],
      windows: [],
      baselines: [],
    } satisfies DashboardSnapshot,
    DEFAULT_CONFIG,
    NOW,
  );

  it("escapes titles, refuses non-https links and applies the shared 'now' window", () => {
    const list = renderSignalListHtml(data, NOW);
    expect(list).toContain("&lt;b&gt;Test&lt;/b&gt; &amp; Co");
    expect(list).not.toContain("<b>Test");
    expect(list).not.toContain("javascript:");
    expect(list).toContain("Odd link");
    expect(list).toContain('<time datetime="');
  });

  it("says when nothing qualifies rather than rendering an empty list", () => {
    const empty = renderSignalListHtml(
      { ...data, map: { ...data.map, events: [] } },
      NOW,
    );
    expect(empty).toContain("No qualifying official signals in this view.");
  });

  it("is placed in the page for readers without JavaScript", () => {
    const page = earthGlobeHtml({ data, now: NOW });
    expect(page).toContain("Odd link");
  });
});

describe("GET /earth", () => {
  async function fetchPage(path: string) {
    const server = createWatcherServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      return { response, body: await response.text() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("serves the globe by default, with its own CSP and the same cache lifetime", async () => {
    const { response, body } = await fetchPage("/earth");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("content-security-policy")).toBe(
      earthGlobeContentSecurityPolicy(),
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(body).toContain('id="globe"');
    expect(body).not.toContain("leaflet");
    expect(body).not.toContain("three.module.js");
  });

  it("leaves /api/earth, /visualizations and the classic page untouched", async () => {
    const classic = await fetchPage("/earth?view=classic");
    expect(classic.body).toContain("leaflet");
    expect(classic.response.headers.get("content-security-policy")).toContain(
      "cartocdn",
    );
    const viz = await fetchPage("/visualizations");
    expect(viz.response.status).toBe(200);
    const api = await fetchPage("/api/earth");
    expect(api.response.status).toBe(200);
    expect(JSON.parse(api.body)).toMatchObject({ ok: true });
  });
});
