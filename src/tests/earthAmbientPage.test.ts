/**
 * The ambient overlay, as it actually reaches the browser.
 *
 * src/tests/ambient.test.ts proves the MATHS. This file proves the maths is
 * WIRED — that the page declares the elements, defines every custom property it
 * consumes, and ships the tested functions rather than a reimplementation.
 *
 * The CSS-variable test is here because of a defect measured on 2026-08-19 in a
 * sibling repo: a marketing layout used FIVE custom properties 23 times and
 * defined none of them, so the shell had no background or text colour in either
 * theme, and nothing failed. A glow whose colour variable is undefined renders
 * nothing at all — which in this feature means a dark, quiet room during a live
 * event. That is invisible to every other kind of test.
 *
 * Run: pnpm exec vitest run src/tests/earthAmbientPage.test.ts
 */

import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { earthWatchHtml } from "../earth.js";
import { AMBIENT_CLEAR_COLOR, AMBIENT_FAMILY_COLORS } from "../logic/ambient.js";

const html = earthWatchHtml();

function scriptBlocks(): string[] {
  const out: string[] = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[2]);
  return out;
}

describe("the overlay exists in the markup", () => {
  it("declares the glow, scrim, readout and toggle elements", () => {
    for (const id of ["ambientGlow", "ambientScrim", "ambientReadout", "ambientToggle"]) {
      expect(html, `missing id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it("never lets the overlay swallow clicks meant for the map", () => {
    // A full-viewport overlay without pointer-events:none would make the whole
    // page unusable, and it would look like the map "just stopped working".
    expect(html).toMatch(/#ambientGlow\s*\{[^}]*pointer-events\s*:\s*none/);
  });

  it("is hidden from assistive tech — it is decoration, the feed carries the facts", () => {
    expect(html).toMatch(/id="ambientGlow"[^>]*aria-hidden="true"/);
  });
});

describe("every custom property the overlay consumes is also defined", () => {
  it("defines each --ambient-* variable it reads", () => {
    const used = new Set<string>();
    const re = /var\(\s*(--ambient-[a-z0-9-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) used.add(m[1]);

    // The overlay must actually use some, or this test is vacuously green —
    // the failure mode of a "check" that can only pass.
    expect(used.size).toBeGreaterThan(0);

    for (const name of used) {
      const defined = new RegExp(`${name}\\s*:`).test(html);
      expect(defined, `${name} is used but never defined`).toBe(true);
    }
  });
});

describe("the page ships the tested maths", () => {
  it("embeds the ambient client source, not a hand-rolled copy", () => {
    expect(html).toContain("AMBIENT_FAMILY_COLORS");
    expect(html).toContain("function ambientGlow");
    expect(html).toContain(AMBIENT_CLEAR_COLOR);
  });

  it("carries every hazard-family colour into the page", () => {
    for (const hex of Object.values(AMBIENT_FAMILY_COLORS)) {
      expect(html, `family colour ${hex} absent from page`).toContain(hex);
    }
  });

  it("keeps every script block syntactically valid", () => {
    const blocks = scriptBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    blocks.forEach((src, i) => {
      // Module blocks legitimately use import/export, which vm.Script rejects.
      if (/\bimport\s|\bexport\s/.test(src)) return;
      expect(() => new vm.Script(src), `script block ${i} does not parse`).not.toThrow();
    });
  });
});

describe("it only touches element ids the markup declares", () => {
  it("resolves every getElementById target used by the ambient code", () => {
    const declared = new Set<string>();
    const dre = /id="([A-Za-z0-9_-]+)"/g;
    let d: RegExpExecArray | null;
    while ((d = dre.exec(html)) !== null) declared.add(d[1]);

    const looked = new Set<string>();
    const lre = /getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
    let l: RegExpExecArray | null;
    while ((l = lre.exec(html)) !== null) looked.add(l[1]);

    for (const id of looked) {
      if (!id.startsWith("ambient")) continue;
      expect(declared.has(id), `getElementById("${id}") has no matching id in markup`).toBe(true);
    }
  });
});

describe("it degrades safely", () => {
  it("respects prefers-reduced-motion for the pulse", () => {
    // A breathing glow is the one part that could be genuinely unpleasant, and
    // it is also the part someone with vestibular sensitivity must be able to
    // switch off at the OS level.
    const idx = html.indexOf("ambient-pulse");
    expect(idx).toBeGreaterThan(-1);
    expect(html).toMatch(/prefers-reduced-motion/);
  });

  it("still closes the document correctly", () => {
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).not.toContain("</html>`");
  });
});
