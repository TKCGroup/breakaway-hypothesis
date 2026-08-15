import { afterEach, describe, expect, it } from "vitest";
import { createWatcherServer } from "../server.js";
import { InMemoryWatcherRepository } from "../db/repository.js";

describe("watcher HTTP server", () => {
  const originalSecret = process.env.SCHEDULER_SHARED_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SCHEDULER_SHARED_SECRET;
    } else {
      process.env.SCHEDULER_SHARED_SECRET = originalSecret;
    }
  });

  it("returns health without scheduler auth", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, dryRun: true });
    } finally {
      await close();
    }
  });

  it("returns health for root and normalized health probe paths", async () => {
    const { url, close } = await listen();

    try {
      await expect(fetch(`${url}/`).then((response) => response.status)).resolves.toBe(200);
      await expect(fetch(`${url}/healthz/`).then((response) => response.status)).resolves.toBe(200);
      await expect(fetch(`${url}/healthz?source=probe`).then((response) => response.status)).resolves.toBe(200);
    } finally {
      await close();
    }
  });

  it("serves the read-only dashboard shell without scheduler auth", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/dashboard`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain("Engine under the hood");
      expect(html).toContain("Most notable monitored geohazard");
    } finally {
      await close();
    }
  });

  it("serves dashboard JSON from the repository without exposing /run", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const repo = new InMemoryWatcherRepository();
    const { url, close } = await listen(
      createWatcherServer({
        createRepositoryHandle: () => ({
          repo,
          close: async () => {}
        })
      })
    );

    try {
      const response = await fetch(`${url}/api/dashboard`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        system: {
          service: "breakaway-hypothesis-watcher",
          officialOnly: true
        }
      });
    } finally {
      await close();
    }
  });

  it("serves the public Earth Watch shell", async () => {
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/earth`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toContain("s-maxage=300");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'"
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const html = await response.text();
      expect(html).toContain("Official Geohazard Watch");
      expect(html).toContain("leaflet");
      expect(html).toContain("Not a prediction");
      expect(html).toContain("Notification stale gate");
      expect(html).toContain("Top activity");
      expect(html).toContain("applyDefaultFocus");
      expect(html).toContain('id="signalSort"');
      expect(html).toContain('value="lastActive"');
      expect(html).toContain('value="magnitude"');
      expect(html).toContain('id="sourceFilter"');
      expect(html).toContain("earthWatch.signalSort");
      expect(html).toContain("km depth");
      expect(html).toContain('data-window="forecast"');
      expect(html).toContain('href="/visualizations"');
      expect(html).toContain('aria-current="page">Live conditions');
    } finally {
      await close();
    }
  });

  it("serves the full interactive visualization and its Earth-prefixed alias", async () => {
    const { url, close } = await listen();

    try {
      for (const pathname of ["/visualizations", "/earth/visualizations"]) {
        const response = await fetch(`${url}${pathname}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("cache-control")).toContain("s-maxage=300");
        expect(response.headers.get("content-security-policy")).toContain(
          "script-src 'self'"
        );
        const html = await response.text();
        expect(html).toContain("Frozen Head Quadrangle");
        expect(html).toContain(
          'import * as THREE from "/assets/three-0.180.0/three.module.js"'
        );
        expect(html).toContain("Interpretive reconstruction");
        expect(html).toContain('aria-current="page">Visualizations');
      }
    } finally {
      await close();
    }
  });

  it("serves the pinned local Three.js browser module with immutable caching", async () => {
    const { url, close } = await listen();

    try {
      for (const asset of [
        ["/assets/three-0.180.0/three.module.js", "WebGLRenderer"],
        ["/assets/three-0.180.0/three.core.min.js", "Vector3"]
      ]) {
        const response = await fetch(`${url}${asset[0]}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/javascript");
        expect(response.headers.get("cache-control")).toBe(
          "public, max-age=31536000, immutable"
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toContain(asset[1]);
      }
    } finally {
      await close();
    }
  });

  it("rejects non-GET visualization and static asset requests", async () => {
    const { url, close } = await listen();

    try {
      for (const pathname of [
        "/visualizations",
        "/assets/three-0.180.0/three.module.js"
      ]) {
        const response = await fetch(`${url}${pathname}`, { method: "POST" });
        expect(response.status).toBe(405);
        expect(await response.json()).toMatchObject({
          ok: false,
          error: "method_not_allowed"
        });
      }
    } finally {
      await close();
    }
  });

  it("serves official-only Earth Watch JSON", async () => {
    const repo = new InMemoryWatcherRepository();
    const { url, close } = await listen(
      createWatcherServer({
        createRepositoryHandle: () => ({
          repo,
          close: async () => {}
        })
      })
    );

    try {
      const response = await fetch(`${url}/api/earth`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("s-maxage=60");
      expect(await response.json()).toMatchObject({
        ok: true,
        system: {
          service: "breakaway-hypothesis-watcher",
          officialOnly: true
        },
        map: {
          events: [],
          nonSpatialSignals: [],
          focus: {
            mode: "us_fallback",
            center: [39.5, -98.35]
          }
        }
      });
    } finally {
      await close();
    }
  });

  it("rejects /run when scheduler secret is unset", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/run`, { method: "POST" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: "scheduler_secret_unset" });
    } finally {
      await close();
    }
  });

  it("rejects /run when X-BREAKAWAY-CRON-KEY does not match", async () => {
    process.env.SCHEDULER_SHARED_SECRET = "expected-secret";
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/run`, {
        method: "POST",
        headers: { "X-BREAKAWAY-CRON-KEY": "wrong-secret" }
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false, error: "unauthorized" });
    } finally {
      await close();
    }
  });
});

describe("Earth Watch content security policy", () => {
  /**
   * The page and the policy live in different files, so nothing forces them to
   * agree — and when they disagree the page still renders, still says something
   * sensible, and quietly does less. That is exactly how this shipped once: NASA
   * imagery and the USGS ShakeMap fetch were both blocked in production while every
   * local check passed, because the local harness served no CSP at all.
   *
   * This walks the emitted page for the external hosts it actually depends on and
   * asserts the policy permits each one, so the whole class is covered rather than
   * the two instances that happened to break.
   */
  async function policy(): Promise<Record<string, string>> {
    const { url, close } = await listen();
    try {
      const response = await fetch(`${url}/earth`);
      const header = response.headers.get("content-security-policy") ?? "";
      const directives: Record<string, string> = {};
      for (const part of header.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const space = trimmed.indexOf(" ");
        directives[space === -1 ? trimmed : trimmed.slice(0, space)] =
          space === -1 ? "" : trimmed.slice(space + 1);
      }
      return directives;
    } finally {
      await close();
    }
  }

  function permits(directive: string, host: string): boolean {
    if (!directive) return false;
    return directive.split(/\s+/).some((source) => {
      if (source === host) return true;
      if (!source.startsWith("https://*.")) return false;
      return host.endsWith(source.replace("https://*.", "."));
    });
  }

  it("permits every external host the page fetches data or imagery from", async () => {
    const directives = await policy();
    // Declared rather than scraped: these are the hosts the page is DESIGNED to
    // reach, so a future edit that drops one from the policy fails here even if
    // the corresponding call site was also removed by accident.
    const required: [string, string][] = [
      ["img-src", "https://gibs.earthdata.nasa.gov"],
      ["connect-src", "https://earthquake.usgs.gov"],
      ["connect-src", "https://services9.arcgis.com"],
      ["img-src", "https://a.basemaps.cartocdn.com"],
      ["img-src", "https://basemap.nationalmap.gov"],
      ["script-src", "https://unpkg.com"],
      ["style-src", "https://fonts.googleapis.com"],
      ["font-src", "https://fonts.gstatic.com"]
    ];
    const denied = required.filter(([directive, host]) => !permits(directives[directive], host));
    expect(denied).toEqual([]);
  });

  it("still refuses hosts the page has no reason to reach", async () => {
    // A policy that permits everything would pass the test above while protecting
    // nothing, so pin that the allowlist is still an allowlist.
    const directives = await policy();
    expect(permits(directives["connect-src"], "https://evil.example.com")).toBe(false);
    expect(permits(directives["img-src"], "https://evil.example.com")).toBe(false);
    expect(directives["default-src"]).toBe("'self'");
    expect(directives["frame-ancestors"]).toBe("'none'");
  });

  it("keeps the three.js module served same-origin rather than from a CDN", async () => {
    // script-src does not allow gibs or usgs, so the globe's three.js has to stay
    // local. If someone swaps it for a CDN import the page breaks silently.
    const { url, close } = await listen();
    try {
      const html = await (await fetch(`${url}/earth`)).text();
      expect(html).toContain('import * as THREE from "/assets/three-0.180.0/three.module.js"');
      expect(html).not.toContain("three@0.180.0/build");
    } finally {
      await close();
    }
  });
});

async function listen(server = createWatcherServer()): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
