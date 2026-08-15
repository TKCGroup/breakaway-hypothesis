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
    for (const id of ["stage", "globe", "globeStatus", "globeClock", "dayNight", "antipodeLayer", "autoSpin"]) {
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
});
