/**
 * Modeled perceptibility ("did you feel it") radii for an earthquake.
 *
 * Source: Atkinson, G. M. and Wald, D. J. (2007), "Did You Feel It?" Intensity Data:
 * A Surprisingly Good Measure of Earthquake Ground Motion, Seismological Research
 * Letters 78(3), 362-368. Equation (1) and Table 1.
 *
 *   MMI = c1 + c2(M-6) + c3(M-6)^2 + c4*log10(R) + c5*R + c6*B + c7*M*log10(R)
 *   R   = sqrt(D^2 + h^2)          D = distance to fault (~hypocentral for point sources)
 *   B   = 0 for R <= Rt, else log10(R / Rt)
 *
 * `h` is a fitted effective-depth saturation term, NOT the event depth; event depth
 * enters through D. Stated average residual is 0.4 MMI units and the regression is
 * described as well-constrained over 10-500 km, which is why radii are clamped at
 * MODEL_MAX_DISTANCE_KM rather than extrapolated.
 *
 * This is a MODEL, not an observation. Where USGS publishes a ShakeMap the page
 * prefers those official contours and only falls back to this.
 */

export interface IntensityCoefficients {
  readonly id: "active_tectonic" | "stable_continental";
  readonly label: string;
  readonly c1: number;
  readonly c2: number;
  readonly c3: number;
  readonly c4: number;
  readonly c5: number;
  readonly c6: number;
  readonly c7: number;
  /** Effective depth saturation term, km. */
  readonly h: number;
  /** Transition distance where the extra attenuation shape switches on, km. */
  readonly rt: number;
}

/** Table 1, "California" column — active tectonic crust. */
export const AW07_ACTIVE_TECTONIC: IntensityCoefficients = {
  id: "active_tectonic",
  label: "Atkinson & Wald (2007) California / active tectonic",
  c1: 12.27,
  c2: 2.27,
  c3: 0.1304,
  c4: -1.3,
  c5: -0.000707,
  c6: 1.95,
  c7: -0.577,
  h: 14,
  rt: 30
};

/** Table 1, "Central and Eastern U.S." column — stable continental crust. */
export const AW07_STABLE_CONTINENTAL: IntensityCoefficients = {
  id: "stable_continental",
  label: "Atkinson & Wald (2007) Central & Eastern U.S. / stable continental",
  c1: 11.72,
  c2: 2.36,
  c3: 0.1155,
  c4: -0.44,
  c5: -0.002044,
  c6: 2.31,
  c7: -0.479,
  h: 17,
  rt: 80
};

/** Outer edge of the distance range the published regression covers. */
export const MODEL_MAX_DISTANCE_KM = 500;

export interface MmiBand {
  readonly mmi: number;
  /** Roman numeral as USGS presents it. */
  readonly numeral: string;
  readonly shaking: string;
  /** USGS ShakeMap intensity colour, so modeled and official rings read alike. */
  readonly color: string;
}

/**
 * The bands worth drawing. Below MMI 3 the shaking is not reliably reported as
 * felt, and above MMI 8 the modeled radius is smaller than the rupture itself.
 */
export const MMI_BANDS: readonly MmiBand[] = [
  { mmi: 3, numeral: "III", shaking: "Weak — felt by a few indoors", color: "#BFCCFF" },
  { mmi: 4, numeral: "IV", shaking: "Light — felt by many indoors", color: "#87CDF6" },
  { mmi: 5, numeral: "V", shaking: "Moderate — felt by nearly everyone", color: "#53FFB1" },
  { mmi: 6, numeral: "VI", shaking: "Strong — some heavy furniture moves", color: "#FFFF52" },
  { mmi: 7, numeral: "VII", shaking: "Very strong — damage to poor structures", color: "#FFC800" },
  { mmi: 8, numeral: "VIII", shaking: "Severe — considerable damage", color: "#FF9000" }
];

export interface FeltRing {
  readonly mmi: number;
  readonly numeral: string;
  readonly shaking: string;
  readonly color: string;
  /** Epicentral radius in km at which the model predicts this intensity. */
  readonly radiusKm: number;
  /** True when the true radius runs past the published distance range and was clamped. */
  readonly clamped: boolean;
}

/**
 * Predicted Modified Mercalli intensity at an epicentral distance.
 * Returns the raw model value; callers decide how to round or present it.
 */
export function predictMmi(
  magnitude: number,
  depthKm: number,
  epicentralDistanceKm: number,
  coefficients: IntensityCoefficients = AW07_ACTIVE_TECTONIC
): number {
  const { c1, c2, c3, c4, c5, c6, c7, h, rt } = coefficients;
  const depth = Number.isFinite(depthKm) && depthKm > 0 ? depthKm : 0;
  const epicentral = Math.max(0, epicentralDistanceKm);
  const faultDistance = Math.hypot(epicentral, depth);
  const r = Math.hypot(faultDistance, h);
  const logR = Math.log10(r);
  const b = r > rt ? Math.log10(r / rt) : 0;
  const dm = magnitude - 6;
  return c1 + c2 * dm + c3 * dm * dm + c4 * logR + c5 * r + c6 * b + c7 * magnitude * logR;
}

/**
 * Epicentral radius at which the model drops to `targetMmi`.
 *
 * Returns undefined when even the epicentre is predicted below the target — that
 * is a real "this was not felt that strongly anywhere" answer, not a failure, and
 * callers must not coerce it to 0. Radii past MODEL_MAX_DISTANCE_KM are clamped
 * because the published regression does not cover them.
 */
export function feltRadiusKm(
  magnitude: number,
  depthKm: number,
  targetMmi: number,
  coefficients: IntensityCoefficients = AW07_ACTIVE_TECTONIC
): { radiusKm: number; clamped: boolean } | undefined {
  if (!Number.isFinite(magnitude) || !Number.isFinite(targetMmi)) return undefined;
  if (predictMmi(magnitude, depthKm, 0, coefficients) < targetMmi) return undefined;
  if (predictMmi(magnitude, depthKm, MODEL_MAX_DISTANCE_KM, coefficients) >= targetMmi) {
    return { radiusKm: MODEL_MAX_DISTANCE_KM, clamped: true };
  }

  let low = 0;
  let high = MODEL_MAX_DISTANCE_KM;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (predictMmi(magnitude, depthKm, mid, coefficients) >= targetMmi) low = mid;
    else high = mid;
  }
  return { radiusKm: Math.round(((low + high) / 2) * 10) / 10, clamped: false };
}

/** Every drawable band this event actually reaches, strongest shaking first. */
export function feltRings(
  magnitude: number | undefined,
  depthKm: number | undefined,
  coefficients: IntensityCoefficients = AW07_ACTIVE_TECTONIC
): FeltRing[] {
  if (!Number.isFinite(magnitude)) return [];
  const rings: FeltRing[] = [];
  for (const band of MMI_BANDS) {
    const solved = feltRadiusKm(magnitude as number, depthKm ?? 0, band.mmi, coefficients);
    if (!solved || solved.radiusKm <= 0) continue;
    rings.push({
      mmi: band.mmi,
      numeral: band.numeral,
      shaking: band.shaking,
      color: band.color,
      radiusKm: solved.radiusKm,
      clamped: solved.clamped
    });
  }
  return rings.sort((a, b) => b.mmi - a.mmi);
}

/**
 * The point on the far side of the planet. Longitude is normalised to (-180, 180]
 * so it round-trips through Leaflet and GeoJSON without a wrap artefact.
 */
export function antipode(lat: number, lon: number): [number, number] {
  const antiLat = -lat;
  let antiLon = lon > 0 ? lon - 180 : lon + 180;
  if (antiLon <= -180) antiLon += 360;
  if (antiLon > 180) antiLon -= 360;
  return [antiLat, antiLon];
}
