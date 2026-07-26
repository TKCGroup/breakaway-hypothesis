import { describe, expect, it } from "vitest";
import { barkleyVisualizationHtml } from "../visualizations.js";

describe("Barkley visualization", () => {
  it("keeps the attached terrain, route, profile, and controls intact", () => {
    const html = barkleyVisualizationHtml();

    expect(html).toContain("Frozen Head Quadrangle");
    expect(html).toContain("Yellow Gate");
    expect(html).toContain("Brushy Mountain Prison");
    expect(html).toContain("Rat Jaw - Fire Tower");
    expect(html).toContain("Big Hell - Chimney Top");
    expect(html).toContain('id="terrainMount"');
    expect(html).toContain('id="profile"');
    expect(html).toContain('id="playButton"');
    expect(html).toContain('id="cameraButton"');
    expect(html).toContain('id="reliefRange"');
    expect(html).toContain("THREE.TubeGeometry");
    expect(html).toContain("ResizeObserver");
  });

  it("discloses the reconstruction and keeps it outside alert inputs", () => {
    const html = barkleyVisualizationHtml();

    expect(html).toContain("The course is unpublished and GPS use is prohibited");
    expect(html).toContain("not used by the alert engine");
    expect(html).not.toContain("/api/earth");
    expect(html).not.toContain("fetch(");
  });
});
