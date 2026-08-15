import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { earthWatchHtml } from "../earth.js";
import { solarClientSource } from "../logic/solar.js";

/**
 * The page's behaviour lives inside a template literal, where TypeScript cannot see
 * it. A stray backtick or an unbalanced brace produces a file that compiles, deploys,
 * and renders a dead page — every other test in this repo stays green through it.
 * (That is not hypothetical: a backtick inside a comment in this exact string
 * silently terminated the literal while `tsc` reported success.)
 *
 * So these tests parse what is actually shipped.
 */

const html = earthWatchHtml();

function scriptBlocks(): { attributes: string; body: string }[] {
  const blocks: { attributes: string; body: string }[] = [];
  const pattern = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let match = pattern.exec(html);
  while (match) {
    if (!/\ssrc=/.test(match[1])) blocks.push({ attributes: match[1], body: match[2] });
    match = pattern.exec(html);
  }
  return blocks;
}

describe("earthWatchHtml script integrity", () => {
  it("ships inline scripts", () => {
    expect(scriptBlocks().length).toBeGreaterThanOrEqual(3);
  });

  it("parses every inline script as valid JavaScript", () => {
    for (const block of scriptBlocks()) {
      // `new vm.Script` parses without executing, so browser globals are irrelevant.
      // ES module syntax is not parseable this way, so the one static import is
      // swapped for an equivalent declaration; everything after it is checked as-is.
      const source = block.body.replace(
        /^\s*import \* as THREE from ".*";\s*$/m,
        "const THREE = {};"
      );
      expect(() => new vm.Script(source)).not.toThrow();
    }
  });

  it("leaves no unterminated template literal in the emitted page", () => {
    // The specific failure that motivated this file: a backtick inside the HTML
    // string closes it early, so the tail of the page becomes TypeScript source.
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).not.toContain("</html>`");
  });

  it("contains no backtick anywhere inside the page source", () => {
    // This has bitten twice. The first time it produced code that COMPILED, so
    // typecheck said nothing; the second time it happened to be a hard syntax
    // error and tsc caught it. Relying on which of those two you get is luck, so
    // assert the property directly: prose in this file uses quotes, never
    // backticks, and a stray one fails here regardless of how it parses.
    expect(html).not.toContain("`");
  });

  it("embeds the solar module rather than a hand-copied second implementation", () => {
    // If these ever diverged, the map would shade night by different maths than the
    // tests verify. Assert the shipped bytes are the module's own serialisation.
    for (const line of solarClientSource().split("\n")) {
      expect(html).toContain(line);
    }
  });
});

describe("earthWatchHtml element wiring", () => {
  const declaredIds = new Set<string>();
  const idPattern = /\sid="([^"]+)"/g;
  let idMatch = idPattern.exec(html);
  while (idMatch) {
    declaredIds.add(idMatch[1]);
    idMatch = idPattern.exec(html);
  }

  it("only looks up element ids that the markup actually declares", () => {
    // Catches the whole class of "wired to a control that was renamed or never
    // added", which otherwise fails silently at runtime as a null dereference.
    const referenced = new Set<string>();
    const pattern = /getElementById\("([^"]+)"\)/g;
    let match = pattern.exec(html);
    while (match) {
      referenced.add(match[1]);
      match = pattern.exec(html);
    }
    expect(referenced.size).toBeGreaterThan(10);
    expect([...referenced].filter((id) => !declaredIds.has(id))).toEqual([]);
  });

  it("declares the controls the new views depend on", () => {
    for (const id of [
      "stage", "globe", "globeStatus", "globeClock", "dayNight", "antipodeLayer", "autoSpin",
      "cycloneLayer", "cycloneParts", "cycloneStatus", "cycloneControls"
    ]) {
      expect(declaredIds.has(id)).toBe(true);
    }
  });

  it("offers both projections and defaults to the flat map", () => {
    expect(html).toContain('data-view="map"');
    expect(html).toContain('data-view="globe"');
    expect(html).toContain('data-stage="map"');
  });
});

describe("earthWatchHtml honesty of claims", () => {
  it("labels the modeled felt radius as a projection, next to the number", () => {
    // The reader must not be able to read a modeled circle as an observation. The
    // caveat has to sit beside the claim, not in a footnote elsewhere on the page.
    expect(html).toContain("Projection, not an observation");
    expect(html).toContain("Atkinson &amp; Wald (2007)");
    expect(html).toContain("felt considerably farther along its strike");
  });

  it("marks official ShakeMap contours as the agency's own product", () => {
    expect(html).toContain("Official USGS product");
  });

  it("does not assert a relationship between an earthquake and its antipode", () => {
    expect(html).toContain("no official source claims a relationship");
  });

  it("reports absent felt data as none received rather than as zero", () => {
    expect(html).toContain("none received by USGS");
  });

  it("gives an earthquake a population reference, a depth, and a run-up chart", () => {
    // A magnitude on its own does not say whether an event matters. All three of
    // these exist to answer "compared to what?", so all three are pinned.
    expect(html).toContain("Nearest major population:");
    expect(html).toContain("Nearest town:");
    expect(html).toContain("<strong>Depth:</strong>");
    expect(html).toContain("Seismic run-up");
    expect(html).toContain("function loadSparkline");
  });

  it("builds the run-up chart from a fresh catalogue query, not from this map", () => {
    // The map payload is a scored, capped selection. Counting it would under-report
    // activity and could render a flat run-up where there was actually a swarm.
    // The disclosure itself rides on the API's `map.method` string, which the page
    // renders at runtime; earth.test.ts asserts that half.
    expect(html).toContain("fdsnws/event/1/query");
    expect(html).toContain("maxradiuskm");
  });

  it("says a sparse chart may be a sparse network rather than a quiet region", () => {
    // Detection capability differs by country, so comparing two regions' charts is
    // not comparing their seismicity. Without this the chart invites a wrong read.
    expect(html).toContain("a quiet region or a sparse network");
  });

  it("distinguishes no catalogued quakes from a failed query", () => {
    // An empty chart and a broken fetch look identical, and the empty one reads as
    // reassurance. They must say different things.
    expect(html).toContain("No catalogued quakes M");
    expect(html).toContain("USGS catalogue unavailable");
  });

  it("credits GeoNames, whose licence requires it", () => {
    expect(html).toContain("GeoNames (CC BY 4.0)");
  });

  it("sends readers to a human page, not a machine feed", () => {
    // NWS and SWPC "official records" are raw JSON. Every place the page renders a
    // link has to route through the same resolver, or one of them quietly keeps
    // dumping a reader into an API response.
    expect(html).toContain("forecast.weather.gov/MapClick.php");
    expect(html).toContain("swpc.noaa.gov/products/planetary-k-index");
    expect(html).toContain("function humanDestination");
    expect(html).toContain("function readableLink");
    // The raw feed stays reachable, but labelled as what it is.
    expect(html).toContain("record (JSON)");
  });

  it("never puts a raw officialUrl into an href without sanitising it", () => {
    // The invariant that actually matters, stated directly rather than by pattern
    // matching the call shape: officialUrl is attacker-adjacent (it comes from a
    // third-party feed) and must always pass through safeUrl or readableLink.
    // Written this way because the first version of this test flagged two call
    // sites that WERE sanitised, just through a local variable.
    const rawInHref = html.match(/href="'\s*\+\s*esc\([^)]*officialUrl/g) ?? [];
    expect(rawInHref).toEqual([]);

    // And the local that does carry it is assigned from the sanitiser.
    expect(html).toContain("var raw = safeUrl(event.officialUrl);");
  });

  it("refuses to let the forecast cone be read as the storm's size", () => {
    // The single most misread graphic in weather. The cone is the envelope of
    // historical CENTRE-position error; it says nothing about how wide the storm is,
    // and the centre leaves it about one time in three. Without this sitting in the
    // cone's own popup, a reader outside the cone reads the map as "I am fine".
    expect(html).toContain("The cone is not the storm.");
    expect(html).toContain("only about two times in three");
    expect(html).toContain("Outside the cone is not the same");
    expect(html).toContain("says nothing about how wide the storm is");
  });

  it("says a cyclone forecast is a forecast, everywhere it draws one", () => {
    expect(html).toContain("A forecast of the centre&rsquo;s path, not a record of it");
    expect(html).toContain("A forecast, not an observation.");
    // And the observed half is labelled as the opposite, so the two cannot blur.
    expect(html).toContain("This part is observation, not forecast.");
  });

  it("names the cyclone republisher instead of implying a direct NHC feed", () => {
    // This page's whole premise is official sources. Esri's Active Hurricanes is
    // NHC's own advisory geometry, but it is still one hop, and NHC's own host
    // cannot be read from a browser at all. Saying "NHC" flat would be a small lie.
    expect(html).toContain("republished by Esri");
    expect(html).toContain("One hop from the issuing agency, not a direct NHC feed");
  });

  it("distinguishes no active cyclones from a failed cyclone request", () => {
    // Same shape as the sparkline rule above: an empty ocean and a dead feed render
    // identically, and the empty one reads as reassurance.
    expect(html).toContain("No active tropical cyclones in any NHC basin");
    expect(html).toContain("The feed answered and it was empty");
    expect(html).toContain("This is a failed request, not a quiet ocean");
  });

  it("treats an ArcGIS error body as a failure rather than an empty ocean", () => {
    // The feature service answers a rejected query with HTTP 200 and an error
    // object. A response.ok check alone would report "no storms".
    expect(html).toContain("payload.error");
    expect(html).toContain("feature service refused the query");
  });

  it("reports an absent cyclone wind speed as not reported rather than as calm", () => {
    // Number(null) is 0, and 0 kt would render as a confident "tropical depression".
    expect(html).toContain("function reportedKt");
    expect(html).toContain('if (value == null || value === "") return null;');
    expect(html).toContain("not reported");
  });

  it("keeps safeUrl refusing anything that is not https", () => {
    // If safeUrl ever stopped being the gate, the test above would still pass
    // while protecting nothing.
    expect(html).toContain('return url.protocol === "https:" ? url.href : "#";');
  });
});
