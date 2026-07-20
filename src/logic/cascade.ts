import { DEFAULT_CONFIG, type WatcherConfig } from "../config.js";
import type { BaselineComparison } from "./baseline.js";
import { getRegionRule } from "./regionMatcher.js";
import { evaluateStaleGate } from "./staleGate.js";
import type { CascadeStage, CascadeState, NormalizedEvent, RegionId, WatchWindow } from "../types.js";

export interface CascadeInput {
  event: NormalizedEvent;
  activeWindows?: WatchWindow[];
  baseline?: BaselineComparison;
  now?: Date;
  config?: WatcherConfig;
  tsunamiStatus?: "none" | "statement" | "watch" | "advisory" | "warning";
}

export function createSpaceWeatherWindow(
  event: NormalizedEvent,
  config: WatcherConfig = DEFAULT_CONFIG
): WatchWindow | undefined {
  if (event.eventType !== "space_weather") {
    return undefined;
  }

  const kp = event.rawJson && typeof event.rawJson === "object" ? Number((event.rawJson as { kp?: unknown }).kp) : NaN;
  const flareClass = event.severity;
  const shouldOpen =
    Number.isFinite(kp) && kp >= config.spaceWeather.s1Triggers.kpG1
      ? true
      : flareClass !== undefined && compareFlareClass(flareClass, config.spaceWeather.s1Triggers.flareMinClass) >= 0
        ? true
        : isDonkiImpulse(event);

  if (!shouldOpen) {
    return undefined;
  }

  const hours = Math.max(...config.spaceWeather.watchWindowHours);
  return {
    id: `window:${event.id}`,
    triggerEventId: event.id,
    triggerType: event.severity ?? event.eventType,
    startedAt: event.eventTime,
    endsAt: new Date(event.eventTime.getTime() + hours * 3_600_000),
    kpMax: Number.isFinite(kp) ? kp : undefined,
    flareClass,
    active: true
  };
}

export function evaluateCascade(input: CascadeInput): CascadeState {
  const config = input.config ?? DEFAULT_CONFIG;
  const now = input.now ?? new Date();
  const staleGate = evaluateStaleGate(input.event, { config, now });
  const region = input.event.region ?? fallbackRegionForState(input.event);
  const activeWindow = input.activeWindows?.find(
    (window) => window.active && window.startedAt <= input.event.eventTime && window.endsAt >= input.event.eventTime
  );

  let stage: CascadeStage = "S0";
  let shouldNotify = false;
  let confidence = 0.1;
  let reason = "baseline/no qualifying trigger";

  if (input.event.eventType === "space_weather") {
    const window = createSpaceWeatherWindow(input.event, config);
    stage = window ? "S1" : "S0";
    reason = window
      ? `space-weather watch opened by ${input.event.severity ?? input.event.title}`
      : "space-weather event below S1 trigger threshold";
    confidence = window ? 0.35 : 0.1;
    shouldNotify = false;
  } else if (input.event.eventType === "tsunami" && isTsunamiAlert(input.event)) {
    stage = "S5";
    reason = `official tsunami ${input.event.severity ?? "product"} from ${input.event.source}`;
    confidence = 0.95;
    shouldNotify = true;
  } else if (input.event.eventType === "volcano_notice" && !input.event.region) {
    stage = "S0";
    reason = "official HANS notice outside configured target regions";
    confidence = 0.2;
    shouldNotify = false;
  } else if (input.event.eventType === "volcano_notice" && isHansElevated(input.event)) {
    stage = "S4";
    reason = `USGS HANS elevated volcano status: ${input.event.severity}`;
    confidence = 0.9;
    shouldNotify = true;
  } else if (input.event.eventType === "earthquake") {
    if (!input.event.region) {
      stage = "S0";
      reason = "official earthquake outside configured target regions";
      confidence = 0.2;
      shouldNotify = false;
    } else {
      const rule = getRegionRule(input.event.region, config);
      const thresholds = rule.alertThresholds;
      const magnitude = input.event.magnitude ?? 0;
      const isTargetMajor = magnitude >= (thresholds.mMinAlert ?? 4.5);
      const isM45PlusTarget = magnitude >= 4.5;
      const isShallow =
        thresholds.shallowDepthKmMax === undefined ||
        input.event.depthKm === undefined ||
        input.event.depthKm <= thresholds.shallowDepthKmMax;
      const rateMultiple = input.baseline?.rateMultiple ?? 0;
      const count24h = input.baseline?.currentCount24h ?? 0;
      const crossesRate = rateMultiple >= (thresholds.swarmRateXBaseline ?? Number.POSITIVE_INFINITY);
      const crossesCount =
        thresholds.swarmCount24h !== undefined ? count24h >= thresholds.swarmCount24h : false;

      if (isM45PlusTarget) {
        stage = "S5";
        reason = `M${magnitude.toFixed(1)} target-region earthquake; tsunami feed status=${input.tsunamiStatus ?? "unknown"}`;
        confidence = 0.9;
        shouldNotify = true;
      } else if (activeWindow && isShallow && isTargetMajor) {
        stage = "S3";
        reason = `new M${magnitude.toFixed(1)} shallow event during active S1 window`;
        confidence = 0.7;
        shouldNotify = true;
      } else if (activeWindow && isShallow && crossesRate) {
        stage = "S3";
        reason = `quake rate ${rateMultiple.toFixed(1)}x baseline during active S1 window`;
        confidence = 0.75;
        shouldNotify = true;
      } else if (activeWindow && (crossesRate || crossesCount)) {
        stage = "S2";
        reason = `local response: ${count24h} quakes/24h, ${rateMultiple.toFixed(1)}x baseline`;
        confidence = 0.5;
        shouldNotify = false;
      } else if (activeWindow) {
        stage = "S1";
        reason = "active S1 window but no local seismic anomaly above threshold";
        confidence = 0.35;
        shouldNotify = false;
      }
    }
  }

  if (!staleGate.passed) {
    shouldNotify = false;
    reason = `${reason}; stale gate failed: ${staleGate.reasons.join(", ")}`;
  }

  return {
    id: `cascade:${region}:${stage}:${input.event.id}`,
    region,
    stage,
    stageStartedAt: now,
    latestEventId: input.event.id,
    activeWindowId: activeWindow?.id,
    reason,
    confidence,
    staleGatePassed: staleGate.passed,
    staleGate,
    shouldNotify
  };
}

function fallbackRegionForState(event: NormalizedEvent): RegionId {
  return event.region ?? "PNW_CASCADIA_OFFSHORE";
}

function isHansElevated(event: NormalizedEvent): boolean {
  const severity = (event.severity ?? "").toUpperCase();
  return ["ADVISORY", "WATCH", "WARNING", "YELLOW", "ORANGE", "RED"].some((token) => severity.includes(token));
}

function isTsunamiAlert(event: NormalizedEvent): boolean {
  const severity = (event.severity ?? event.title).toLowerCase();
  return severity.includes("warning") || severity.includes("advisory");
}

function isDonkiImpulse(event: NormalizedEvent): boolean {
  if (event.source !== "nasa_donki") {
    return false;
  }
  const severity = (event.severity ?? "").toUpperCase();
  return ["CME", "GST", "IPS", "SEP", "HSS"].includes(severity);
}

export function compareFlareClass(actual: string, threshold: string): number {
  const parsedActual = parseFlare(actual);
  const parsedThreshold = parseFlare(threshold);
  return parsedActual - parsedThreshold;
}

function parseFlare(value: string): number {
  const match = value.trim().toUpperCase().match(/^([ABCMX])\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return 0;
  }
  const classBase: Record<string, number> = { A: 1, B: 10, C: 100, M: 1000, X: 10000 };
  return classBase[match[1]] * Number(match[2]);
}
