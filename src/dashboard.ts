import { DEFAULT_CONFIG, OFFICIAL_SOURCES, type RegionRule, type WatcherConfig } from "./config.js";
import type {
  CascadeStage,
  CascadeState,
  NormalizedEvent,
  OfficialSource,
  RegionBaseline,
  SourceRun,
  WatchWindow
} from "./types.js";
import type { WatcherRepository } from "./db/repository.js";

const SCHEDULED_SOURCES = [
  "usgs_earthquake_geojson",
  "usgs_hans",
  "swpc_kp",
  "nasa_donki",
  "nasa_eonet",
  "nws_alerts",
  "tsunami_ntwc",
  "tsunami_ptwc"
] as const;

type SourceHealthStatus = "ok" | "running" | "stale" | "error" | "missing";

interface SourceSummary {
  source: string;
  label: string;
  status: SourceHealthStatus;
  startedAt?: string;
  completedAt?: string;
  ageMinutes?: number;
  staleAfterHours: number;
  recordsSeen: number;
  error?: string;
}

interface RegionSummary {
  region: string;
  label: string;
  stage: CascadeStage;
  effectiveStage: CascadeStage;
  stageLabel: string;
  operatorSummary: string;
  reason: string;
  confidence: number;
  staleGatePassed: boolean;
  stageStartedAt?: string;
  latestEventId?: string;
  latestEvent?: EventSummary;
  activeWindowId?: string;
  comparatorOnly: boolean;
  alertThreshold: string;
  activity?: RegionActivitySummary;
}

interface EventSummary {
  id: string;
  source: string;
  sourceLabel: string;
  externalId: string;
  eventType: string;
  region?: string;
  title: string;
  eventTime: string;
  sourceUpdatedAt: string;
  ingestTime: string;
  magnitude?: number;
  depthKm?: number;
  lat?: number;
  lon?: number;
  severity?: string;
  officialUrl: string;
}

interface NotificationSummary {
  id: string;
  cascadeStateId: string;
  sentAt: string;
  channel: string;
  title: string;
  dedupeKey: string;
}

interface WindowSummary {
  id: string;
  triggerEventId: string;
  triggerType: string;
  startedAt: string;
  endsAt: string;
  active: boolean;
  kpMax?: number;
  flareClass?: string;
  cmeArrivalTime?: string;
  score?: string;
}

interface BaselineSummary {
  region: string;
  label: string;
  metric: string;
  windowDays: number;
  computedAt: string;
  value: number;
  sampleCount: number;
}

interface ActivityPoint {
  date: string;
  count: number;
  maxMagnitude?: number;
}

interface ActivityComparisonPoint {
  endedAt: string;
  count: number;
}

interface OfficialContextReference {
  title: string;
  source: string;
  publishedAt: string;
  metric: string;
  officialUrl: string;
}

interface RegionActivitySummary {
  historyDays: number;
  sparkWindowDays: number;
  catalogMinMagnitude: number;
  currentCount24h: number;
  currentMaxMagnitude?: number;
  baselineCount24h: number;
  rateMultiple: number;
  percentile: number;
  previousAtOrAbove?: ActivityComparisonPoint;
  recentPeak: ActivityComparisonPoint;
  absoluteThreshold?: number;
  sparkline: ActivityPoint[];
  officialContext: OfficialContextReference[];
}

interface StageChangeSummary {
  region: string;
  label: string;
  fromStage: CascadeStage;
  toStage: CascadeStage;
}

type NotableEventPeriod = "active" | "recent" | "forecast";

interface NotableTimelinePoint {
  date: string;
  eventCount: number;
  maxScore: number;
}

interface NotableComparisonPoint {
  title: string;
  occurredAt: string;
  score: number;
  officialUrl: string;
}

interface NotableEventSummary {
  period: NotableEventPeriod;
  periodLabel: string;
  category: string;
  metric: string;
  score: number;
  rarityPercentile: number;
  comparableCount: number;
  occurredAt: string;
  endsAt?: string;
  event: EventSummary;
  selectionReason: string;
  scoreBreakdown: string;
  comparisonBasis: string;
  previousAtOrAbove?: NotableComparisonPoint;
  candidateCount: number;
  timeline: NotableTimelinePoint[];
  forecastCoverage: string;
}

export interface DashboardData {
  ok: true;
  generatedAt: string;
  system: {
    service: string;
    mode: "live" | "dry_run";
    dryRun: boolean;
    pollIntervalMinutes: number;
    officialOnly: true;
    notificationChannel: "slack_bot" | "webhook" | "dry_run" | "unconfigured";
    hardRule: string;
  };
  posture: {
    stage: CascadeStage;
    label: string;
    action: string;
    detail: string;
    tone: "normal" | "watch" | "elevated" | "critical";
    sourceHealth: "healthy" | "degraded";
    sourceHealthDetail: string;
  };
  notableEvent?: NotableEventSummary;
  latestCycle: {
    startedAt?: string;
    completedAt?: string;
    officialEventsIngested: number;
    targetEventsIngested: number;
    cascadeChecks: number;
    staleGatePassed: number;
    alertsSent: number;
    sourceFailures: string[];
    stageChanges: StageChangeSummary[];
    materialChange: boolean;
    headline: string;
    detail: string;
  };
  summary: {
    latestIngestAt?: string;
    latestSourceUpdatedAt?: string;
    latestRunCompletedAt?: string;
    maxCurrentStage: CascadeStage;
    eventsLast24h: number;
    notificationsLast24h: number;
    activeWindows: number;
    staleGatePassedLast24h: number;
    staleGateCheckedLast24h: number;
  };
  pipeline: Array<{
    step: string;
    status: "ok" | "watch" | "warn";
    detail: string;
  }>;
  sources: SourceSummary[];
  regions: RegionSummary[];
  activeWindows: WindowSummary[];
  recentEvents: EventSummary[];
  filteredOfficialEvents: EventSummary[];
  recentNotifications: NotificationSummary[];
  baselines: BaselineSummary[];
}

export async function buildDashboardData(
  repo: WatcherRepository,
  config: WatcherConfig = DEFAULT_CONFIG,
  now = new Date()
): Promise<DashboardData> {
  const [events, sourceRuns, cascadeStates, notifications, windows, baselines] = await Promise.all([
    repo.listEvents(),
    repo.listSourceRuns(),
    repo.listCascadeStates(),
    repo.listNotifications(),
    repo.listWatchWindows(),
    repo.listRegionBaselines()
  ]);

  const liveEvents = events
    .filter((event) => event.source !== "usgs_fdsn_backfill")
    .sort((a, b) => b.ingestTime.getTime() - a.ingestTime.getTime());
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const cascadeByRegion = latestCascadeByRegion(cascadeStates, eventsById);
  const activityByRegion = regionActivitySummaries(config, events, baselines, now);
  const regions = config.regions.map((rule) => {
    const state = cascadeByRegion.get(rule.id);
    return regionSummary(
      rule,
      state,
      state ? eventsById.get(state.latestEventId) : undefined,
      activityByRegion.get(rule.id)
    );
  });
  const sources = sourceSummaries(sourceRuns, liveEvents, config, now);
  const latestCycle = latestCycleSummary(config, sourceRuns, liveEvents, cascadeStates, notifications, eventsById);
  const posture = postureSummary(regions, sources);
  const notableEvent = mostNotableEvent(events, windows, now);
  const latestRunCompletedAt = latestCycle.completedAt ?? maxIso(sourceRuns.map((run) => run.completedAt));
  const latestIngestAt = maxIso(liveEvents.map((event) => event.ingestTime));
  const latestSourceUpdatedAt = maxIso(liveEvents.map((event) => event.sourceUpdatedAt));
  const statesLast24h = cascadeStates.filter((state) => state.stageStartedAt >= hoursAgo(now, 24));
  const activeWindows = windows
    .filter((window) => window.active && window.endsAt > now)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  const recentNotifications = notifications
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, 12)
    .map((notification) => ({
      id: notification.id,
      cascadeStateId: notification.cascadeStateId,
      sentAt: notification.sentAt.toISOString(),
      channel: notification.channel,
      title: notification.title,
      dedupeKey: notification.dedupeKey
    }));

  return {
    ok: true,
    generatedAt: now.toISOString(),
    system: {
      service: "breakaway-hypothesis-watcher",
      mode: config.dryRun ? "dry_run" : "live",
      dryRun: config.dryRun,
      pollIntervalMinutes: config.pollIntervalMinutes,
      officialOnly: true,
      notificationChannel: notificationChannel(config),
      hardRule:
        "Alerts are generated only from official source records after stale-gate evaluation; news, search, social, and snippets are excluded."
    },
    posture,
    notableEvent,
    latestCycle,
    summary: {
      latestIngestAt,
      latestSourceUpdatedAt,
      latestRunCompletedAt,
      maxCurrentStage: maxRegionStage(regions),
      eventsLast24h: liveEvents.filter((event) => event.eventTime >= hoursAgo(now, 24)).length,
      notificationsLast24h: notifications.filter((notification) => notification.sentAt >= hoursAgo(now, 24)).length,
      activeWindows: activeWindows.length,
      staleGatePassedLast24h: statesLast24h.filter((state) => state.staleGatePassed).length,
      staleGateCheckedLast24h: statesLast24h.length
    },
    pipeline: pipelineSummary(config, sourceRuns, statesLast24h, notifications, now),
    sources,
    regions,
    activeWindows: activeWindows.map(windowSummary),
    recentEvents: liveEvents
      .filter((event) => event.region && event.region !== "CARIBBEAN_VENEZUELA_COMPARATOR")
      .slice(0, 24)
      .map(eventSummary),
    filteredOfficialEvents: liveEvents
      .filter((event) => !event.region || event.region === "CARIBBEAN_VENEZUELA_COMPARATOR")
      .slice(0, 12)
      .map(eventSummary),
    recentNotifications,
    baselines: baselines
      .sort((a, b) => a.region.localeCompare(b.region) || b.windowDays - a.windowDays)
      .map(baselineSummary)
  };
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Geospace Watcher Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2f5f1;
      --panel: #ffffff;
      --ink: #162019;
      --muted: #626d64;
      --line: #d9e1d8;
      --ok: #167244;
      --watch: #8a5700;
      --warn: #b42318;
      --soft-ok: #e7f5ed;
      --soft-watch: #fff3d9;
      --soft-warn: #fdebea;
      --accent: #176151;
      --blue: #236a9e;
      --soft-blue: #e8f2f8;
      --stage0: #8a938b;
      --stage1: #3677a8;
      --stage2: #8362b5;
      --stage3: #a05f00;
      --stage4: #b4441c;
      --stage5: #b42318;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      background: var(--bg);
      color: var(--ink);
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .shell { max-width: 1400px; margin: 0 auto; padding: 20px 24px; }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      padding: 12px 0 14px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 24px; line-height: 1.15; letter-spacing: 0; }
    .subhead { margin: 5px 0 0; max-width: 760px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .statusbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel);
      font-size: 13px;
      font-weight: 650;
      white-space: nowrap;
    }
    .pill.ok { color: var(--ok); background: var(--soft-ok); border-color: #b8dec8; }
    .pill.warn { color: var(--warn); background: var(--soft-warn); border-color: #f2bfba; }
    .pill.watch { color: var(--watch); background: var(--soft-watch); border-color: #f2d08e; }
    main { display: grid; gap: 14px; padding-top: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(145px, 1fr)); gap: 10px; }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-height: 90px;
    }
    .metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { margin-top: 8px; font-size: 24px; font-weight: 750; line-height: 1.1; }
    .metric .note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }
    h2 { margin: 0; font-size: 16px; line-height: 1.2; }
    .section-note { color: var(--muted); font-size: 12px; }
    .pipeline { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--line); }
    .step { background: var(--panel); padding: 16px; min-height: 122px; }
    .step-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 750; }
    .step-detail { margin-top: 10px; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .regions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--line); }
    .region {
      border: 0;
      border-left: 4px solid var(--stage0);
      border-radius: 0;
      background: var(--panel);
      padding: 15px 16px 14px;
      min-height: 190px;
      display: grid;
      gap: 9px;
      align-content: start;
    }
    .region.S0 { border-left-color: var(--stage0); }
    .region.S1 { border-left-color: var(--stage1); }
    .region.S2 { border-left-color: var(--stage2); }
    .region.S3 { border-left-color: var(--stage3); }
    .region.S4 { border-left-color: var(--stage4); }
    .region.S5 { border-left-color: var(--stage5); }
    .region-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    .region-name { font-weight: 750; line-height: 1.2; }
    .stage {
      flex: 0 0 auto;
      min-width: 42px;
      text-align: center;
      border-radius: 8px;
      padding: 6px 8px;
      color: #fff;
      font-weight: 800;
      font-size: 13px;
      white-space: nowrap;
    }
    .stage.S0 { background: var(--stage0); }
    .stage.S1 { background: var(--stage1); }
    .stage.S2 { background: var(--stage2); }
    .stage.S3 { background: var(--stage3); }
    .stage.S4 { background: var(--stage4); }
    .stage.S5 { background: var(--stage5); }
    .reason { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .micro { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .region-summary { font-weight: 700; font-size: 13px; line-height: 1.4; }
    .region-event { padding-top: 9px; border-top: 1px solid var(--line); font-size: 12px; line-height: 1.4; }
    .region-event .event-label, .threshold-label { display: block; color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .region-event a { display: inline-block; margin-top: 3px; font-weight: 700; }
    .threshold { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .region-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; color: var(--muted); font-size: 11px; }
    .engine-reason { color: var(--muted); font-size: 11px; }
    .engine-reason summary { cursor: pointer; }
    .stage.blocked { background: #6f776f; }
    .activity {
      margin-top: 2px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }
    .activity > summary {
      cursor: pointer;
      color: var(--ink);
      font-size: 12px;
      font-weight: 750;
    }
    .activity-body { display: grid; gap: 11px; padding-top: 11px; }
    .activity-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .activity-stat { min-width: 0; padding-right: 8px; border-right: 1px solid var(--line); }
    .activity-stat:last-child { border-right: 0; padding-right: 0; }
    .activity-value { font-size: 17px; font-weight: 800; line-height: 1.15; }
    .activity-label { margin-top: 4px; color: var(--muted); font-size: 10px; line-height: 1.3; }
    .spark-wrap { display: grid; gap: 5px; }
    .spark {
      height: 62px;
      display: flex;
      align-items: end;
      gap: 1px;
      padding: 6px 5px 0;
      border-bottom: 1px solid var(--line);
      background: #fafbf9;
      overflow: hidden;
    }
    .spark-bar {
      flex: 1 1 2px;
      min-width: 1px;
      max-width: 10px;
      background: #9bbcaf;
      border-radius: 2px 2px 0 0;
    }
    .spark-bar.current { background: var(--stage3); }
    .spark-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: 9px; }
    .threshold-track { height: 7px; border-radius: 4px; background: #e7ece6; overflow: hidden; }
    .threshold-fill { height: 100%; background: var(--stage3); border-radius: inherit; }
    .activity-read { margin: 0; font-size: 11px; font-weight: 700; line-height: 1.4; }
    .activity-caveat { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .official-context { display: grid; gap: 6px; padding-top: 9px; border-top: 1px solid var(--line); }
    .official-context a { font-size: 11px; font-weight: 700; }
    .official-context span { display: block; color: var(--muted); font-size: 10px; line-height: 1.35; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; background: #fafbf9; }
    td.nowrap, th.nowrap { white-space: nowrap; }
    .title-cell { max-width: 420px; }
    .table-wrap { overflow-x: auto; }
    .empty { padding: 22px 16px; color: var(--muted); }
    .source-status {
      display: inline-flex;
      min-width: 64px;
      justify-content: center;
      border-radius: 999px;
      padding: 4px 8px;
      font-weight: 750;
      font-size: 12px;
      text-transform: uppercase;
    }
    .source-status.ok { color: var(--ok); background: var(--soft-ok); }
    .source-status.running, .source-status.stale { color: var(--watch); background: var(--soft-watch); }
    .source-status.error, .source-status.missing { color: var(--warn); background: var(--soft-warn); }
    footer { padding: 22px 0 10px; color: var(--muted); font-size: 12px; }
    .loading, .error {
      margin-top: 18px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .error { border-color: #f2bfba; background: var(--soft-warn); color: var(--warn); }
    .verdict {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(340px, .8fr);
      gap: 20px;
      padding: 20px;
      border-left-width: 6px;
    }
    .verdict.normal { border-left-color: var(--ok); background: #f8fcf9; }
    .verdict.watch { border-left-color: var(--blue); background: #f7fbfd; }
    .verdict.elevated { border-left-color: var(--watch); background: #fffaf0; }
    .verdict.critical { border-left-color: var(--warn); background: #fff8f7; }
    .eyebrow { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .verdict-title { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .verdict-title h2 { font-size: 28px; line-height: 1.1; }
    .verdict-copy { margin: 9px 0 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .operator-action { display: inline-flex; margin-top: 14px; padding: 7px 10px; border-radius: 6px; background: var(--ink); color: #fff; font-size: 12px; font-weight: 800; }
    .verdict-facts { display: grid; grid-template-columns: 1fr; align-content: center; }
    .fact { display: grid; grid-template-columns: 130px 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .fact:last-child { border-bottom: 0; }
    .fact-label { color: var(--muted); }
    .fact-value { text-align: right; font-weight: 750; }
    .notable { border-left: 6px solid var(--stage4); }
    .notable-inner { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr); gap: 20px; padding: 18px; }
    .notable-title-row { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    .notable h2 { margin-top: 6px; font-size: 21px; }
    .notable-event { display: inline-block; margin-top: 10px; font-size: 17px; font-weight: 800; line-height: 1.3; }
    .period-badge { flex: 0 0 auto; padding: 5px 8px; border-radius: 6px; background: var(--soft-watch); color: var(--watch); font-size: 11px; font-weight: 800; }
    .period-badge.forecast { background: var(--soft-blue); color: var(--blue); }
    .period-badge.active { background: var(--soft-warn); color: var(--warn); }
    .notable-copy { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .notable-score { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; border-left: 1px solid var(--line); padding-left: 18px; }
    .notable-stat { padding: 8px 10px; border-bottom: 1px solid var(--line); }
    .notable-stat:nth-child(odd) { padding-left: 0; border-right: 1px solid var(--line); }
    .notable-stat-value { font-size: 19px; font-weight: 800; line-height: 1.2; }
    .notable-stat-label { margin-top: 4px; color: var(--muted); font-size: 10px; line-height: 1.35; }
    .notable-context { display: grid; gap: 10px; padding: 0 18px 18px; }
    .notable-spark {
      height: 62px;
      display: flex;
      align-items: end;
      gap: 2px;
      padding-top: 5px;
      border-bottom: 1px solid var(--line);
      background: #fafbf9;
    }
    .notable-bar { flex: 1 1 3px; min-width: 1px; max-width: 16px; border-radius: 2px 2px 0 0; background: #9bbcaf; }
    .notable-bar.future { background: #8db7d1; }
    .notable-bar.selected { background: var(--stage4); }
    .notable-timeline-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: 9px; }
    .notable-audit { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .notable-method { display: grid; gap: 5px; padding: 10px 12px; border: 1px solid var(--line); background: #fafbf9; font-size: 10px; line-height: 1.4; color: var(--muted); }
    .notable-method strong { color: var(--ink); }
    .change-panel { display: grid; grid-template-columns: minmax(260px, .9fr) minmax(0, 1.5fr); }
    .change-copy { padding: 17px 18px; border-right: 1px solid var(--line); }
    .change-copy h2 { margin-top: 7px; font-size: 18px; }
    .change-copy p { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .change-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .change-stat { padding: 17px 14px; border-right: 1px solid var(--line); }
    .change-stat:last-child { border-right: 0; }
    .change-value { margin-top: 8px; font-size: 22px; font-weight: 800; }
    .change-label { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .stage-change-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .stage-change { padding: 4px 7px; border-radius: 5px; background: var(--soft-watch); color: var(--watch); font-size: 11px; font-weight: 750; }
    .support {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .support > summary {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      cursor: pointer;
      font-weight: 750;
      list-style-position: inside;
    }
    .support > summary span { color: var(--muted); font-size: 12px; font-weight: 500; }
    .support[open] > summary { border-bottom: 1px solid var(--line); }
    .hard-rule { display: flex; gap: 10px; align-items: start; padding: 12px 14px; border: 1px solid #b8dec8; border-radius: 8px; background: var(--soft-ok); color: #245c3f; font-size: 12px; line-height: 1.45; }
    @media (max-width: 1120px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .verdict { grid-template-columns: 1fr; }
      .notable-inner { grid-template-columns: 1fr; }
      .notable-score { border-left: 0; border-top: 1px solid var(--line); padding: 10px 0 0; }
      .change-panel { grid-template-columns: 1fr; }
      .change-copy { border-right: 0; border-bottom: 1px solid var(--line); }
    }
    @media (max-width: 680px) {
      .shell { padding: 14px; }
      header { grid-template-columns: 1fr; }
      .statusbar { justify-content: flex-start; }
      .metrics, .pipeline, .regions { grid-template-columns: 1fr; }
      .change-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .change-stat:nth-child(2) { border-right: 0; }
      .change-stat:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
      .verdict { padding: 16px; }
      .verdict-title h2 { font-size: 23px; }
      .fact { grid-template-columns: 1fr auto; }
      h1 { font-size: 22px; }
      .activity-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .activity-stat:nth-child(2) { border-right: 0; }
      .activity-stat:nth-child(-n+2) { padding-bottom: 7px; border-bottom: 1px solid var(--line); }
      .notable-inner { padding: 15px; }
      .notable-context { padding: 0 15px 15px; }
      .notable-title-row { display: grid; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Geospace Watcher</h1>
        <p class="subhead">Official-source geohazard monitoring, freshness controls, cascade scoring, and live Slack output.</p>
      </div>
      <div id="statusbar" class="statusbar"></div>
    </header>
    <div id="app" class="loading">Loading live watcher state...</div>
    <footer>Read-only operator view. Auto-refreshes every 30 seconds from persisted official-source records.</footer>
  </div>
  <script>
    const app = document.getElementById("app");
    const statusbar = document.getElementById("statusbar");
    const stageRank = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };

    async function loadDashboard() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Dashboard API returned HTTP " + response.status);
        }
        render(await response.json());
      } catch (error) {
        app.className = "error";
        app.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    function render(data) {
      const modeClass = data.system.dryRun ? "watch" : "ok";
      statusbar.innerHTML = [
        pill(data.system.mode === "live" ? "LIVE" : "DRY RUN", modeClass),
        pill("Official sources only", "ok"),
        pill(data.system.pollIntervalMinutes + "-minute cadence", "watch"),
        pill("Updated " + relative(data.generatedAt), "")
      ].join("");

      app.className = "";
      app.innerHTML = [
        verdict(data),
        notableEvent(data.notableEvent),
        latestCycle(data.latestCycle),
        metrics(data),
        regions(data.regions),
        pipeline(data.pipeline),
        "<div class=\\"grid-2\\">" + activeWindows(data.activeWindows.slice(0, 6)) + notifications(data.recentNotifications.slice(0, 6)) + "</div>",
        sources(data.sources),
        recentEvents(data.recentEvents),
        "<div class=\\"grid-2\\">" + comparatorRegion(data.regions) + baselines(data.baselines) + "</div>",
        filteredEvents(data.filteredOfficialEvents),
        "<div class=\\"hard-rule\\"><strong>Alert guardrail</strong><span>" + esc(data.system.hardRule) + "</span></div>"
      ].join("");
    }

    function pill(text, cls) {
      return "<span class=\\"pill " + cls + "\\">" + esc(text) + "</span>";
    }

    function verdict(data) {
      const p = data.posture;
      const sourceClass = p.sourceHealth === "healthy" ? "ok" : "warn";
      const delivery = data.system.dryRun ? "Dry run; nothing posts" : data.system.notificationChannel === "unconfigured" ? "Not configured" : "Live and standing by";
      return "<section class=\\"verdict " + escAttr(p.tone) + "\\">" +
        "<div><div class=\\"eyebrow\\">Current operating posture</div><div class=\\"verdict-title\\"><span class=\\"stage " + escAttr(p.stage) + "\\">" + esc(p.stage) + "</span><h2>" + esc(p.label) + "</h2></div><p class=\\"verdict-copy\\">" + esc(p.detail) + "</p><span class=\\"operator-action\\">" + esc(p.action) + "</span></div>" +
        "<div class=\\"verdict-facts\\">" +
          fact("Official feeds", "<span class=\\"source-status " + sourceClass + "\\">" + esc(p.sourceHealth) + "</span> " + esc(p.sourceHealthDetail)) +
          fact("Last official ingest", esc(relative(data.summary.latestIngestAt))) +
          fact("Slack delivery", esc(delivery)) +
        "</div>" +
      "</section>";
    }

    function fact(label, valueHtml) {
      return "<div class=\\"fact\\"><span class=\\"fact-label\\">" + esc(label) + "</span><span class=\\"fact-value\\">" + valueHtml + "</span></div>";
    }

    function notableEvent(item) {
      if (!item) {
        return "<section><div class=\\"section-head\\"><h2>Most notable monitored geohazard</h2><span class=\\"section-note\\">official sources only</span></div><div class=\\"empty\\">No qualifying official event in the current coverage window.</div></section>";
      }
      const selectedDay = item.occurredAt.slice(0, 10);
      const bars = item.timeline.map((point, index) => {
        const height = point.maxScore ? Math.max(7, point.maxScore) : 3;
        const future = index > 30 ? " future" : "";
        const selected = point.date.slice(0, 10) === selectedDay ? " selected" : "";
        const title = shortDate(point.date) + ": " + point.eventCount + " candidate" + (point.eventCount === 1 ? "" : "s") + ", max score " + point.maxScore;
        return "<span class=\\"notable-bar" + future + selected + "\\" style=\\"height:" + height + "%\\" title=\\"" + escAttr(title) + "\\"></span>";
      }).join("");
      const previous = item.previousAtOrAbove
        ? "<a href=\\"" + escAttr(item.previousAtOrAbove.officialUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + esc(shortDate(item.previousAtOrAbove.occurredAt) + " · " + item.previousAtOrAbove.title) + "</a>"
        : "None in available comparison records";
      const timing = item.period === "forecast"
        ? "Expected " + fmtTime(item.occurredAt)
        : item.period === "active"
          ? "Active" + (item.endsAt ? " until " + fmtTime(item.endsAt) : " now")
          : fmtTime(item.occurredAt);
      const region = item.event.region ? item.event.region.replaceAll("_", " ") : "Global / source-defined area";
      return "<section class=\\"notable\\">" +
        "<div class=\\"notable-inner\\"><div>" +
          "<div class=\\"notable-title-row\\"><div><div class=\\"eyebrow\\">Most notable monitored geohazard</div><h2>" + esc(item.category) + "</h2></div><span class=\\"period-badge " + escAttr(item.period) + "\\">" + esc(item.periodLabel) + "</span></div>" +
          "<a class=\\"notable-event\\" href=\\"" + escAttr(item.event.officialUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + esc(item.event.title) + "</a>" +
          "<p class=\\"notable-copy\\">" + esc(item.selectionReason) + "</p>" +
        "</div><div class=\\"notable-score\\">" +
          notableStat(item.score + "/100", "Transparent notability score") +
          notableStat(item.comparableCount === 1 ? "Only record" : item.rarityPercentile + "th", "Percentile within comparable records") +
          notableStat(item.metric, "Official event metric") +
          notableStat(timing, "Timing") +
        "</div></div>" +
        "<div class=\\"notable-context\\">" +
          "<div><div class=\\"notable-spark\\" aria-label=\\"Daily highest official notability score from 30 days ago through 30 days ahead\\">" + bars + "</div><div class=\\"notable-timeline-labels\\"><span>-30 days</span><span>daily max score · Now</span><span>+30 days</span></div></div>" +
          "<div class=\\"notable-audit\\"><span>Official source: " + esc(item.event.sourceLabel) + "</span><span>Event/forecast time: " + esc(fmtTime(item.occurredAt)) + "</span><span>Source updated: " + esc(fmtTime(item.event.sourceUpdatedAt)) + "</span><span>Scope: " + esc(region) + "</span></div>" +
          "<div class=\\"notable-method\\"><div><strong>Why it ranked first:</strong> " + esc(item.scoreBreakdown) + "</div><div><strong>Rarity basis:</strong> " + esc(item.comparisonBasis) + "</div><div><strong>Previous equal or higher:</strong> " + previous + "</div><div><strong>Forecast boundary:</strong> " + esc(item.forecastCoverage) + "</div><div>Notability is not verified impact, casualties, or an emergency declaration.</div></div>" +
        "</div>" +
      "</section>";
    }

    function notableStat(value, label) {
      return "<div class=\\"notable-stat\\"><div class=\\"notable-stat-value\\">" + esc(value) + "</div><div class=\\"notable-stat-label\\">" + esc(label) + "</div></div>";
    }

    function latestCycle(cycle) {
      const changes = cycle.stageChanges.length
        ? "<div class=\\"stage-change-list\\">" + cycle.stageChanges.map((change) => "<span class=\\"stage-change\\">" + esc(change.label) + ": " + esc(change.fromStage) + " -> " + esc(change.toStage) + "</span>").join("") + "</div>"
        : "";
      return "<section class=\\"change-panel\\"><div class=\\"change-copy\\"><div class=\\"eyebrow\\">Since the latest scheduled run" + (cycle.completedAt ? " · " + esc(relative(cycle.completedAt)) : "") + "</div><h2>" + esc(cycle.headline) + "</h2><p>" + esc(cycle.detail) + "</p>" + changes + "</div>" +
        "<div class=\\"change-stats\\">" +
          changeStat(cycle.targetEventsIngested, "New target events") +
          changeStat(cycle.stageChanges.length, "Region stage changes") +
          changeStat(cycle.alertsSent, "Slack alerts") +
          changeStat(cycle.sourceFailures.length, "Source failures") +
        "</div></section>";
    }

    function changeStat(value, label) {
      return "<div class=\\"change-stat\\"><div class=\\"change-label\\">" + esc(label) + "</div><div class=\\"change-value\\">" + esc(value) + "</div></div>";
    }

    function metrics(data) {
      const s = data.summary;
      const suppressed = Math.max(0, s.staleGateCheckedLast24h - s.staleGatePassedLast24h);
      return "<div class=\\"metrics\\">" +
        metric("Official events / 24h", s.eventsLast24h, "Live records; backfill excluded") +
        metric("Slack alerts / 24h", s.notificationsLast24h, data.system.notificationChannel === "slack_bot" ? "Live #world-alerts delivery" : data.system.notificationChannel) +
        metric("Space-weather context", s.activeWindows, "Open watch windows; not hazard alerts") +
        metric("Old / ineligible checks blocked", suppressed, s.staleGatePassedLast24h + " fresh checks allowed through") +
      "</div>";
    }

    function metric(label, value, note) {
      return "<div class=\\"metric\\"><div class=\\"label\\">" + esc(label) + "</div><div class=\\"value\\">" + esc(value) + "</div><div class=\\"note\\">" + esc(note || "n/a") + "</div></div>";
    }

    function pipeline(steps) {
      return "<section><div class=\\"section-head\\"><h2>Engine under the hood</h2><span class=\\"section-note\\">official ingest -> stale gate -> cascade -> Slack</span></div><div class=\\"pipeline\\">" +
        steps.map((step) => "<div class=\\"step\\"><div class=\\"step-title\\"><span>" + esc(step.step) + "</span>" + pill(step.status.toUpperCase(), step.status === "warn" ? "warn" : step.status === "watch" ? "watch" : "ok") + "</div><div class=\\"step-detail\\">" + esc(step.detail) + "</div></div>").join("") +
      "</div></section>";
    }

    function regions(items) {
      const targets = items
        .filter((item) => !item.comparatorOnly)
        .sort((a, b) => stageRank[b.effectiveStage] - stageRank[a.effectiveStage] || String(a.label).localeCompare(String(b.label)));
      return "<section><div class=\\"section-head\\"><h2>Target regions</h2><span class=\\"section-note\\">highest urgency first · notification threshold begins at S3</span></div><div class=\\"regions\\">" +
        targets.map(regionCard).join("") +
      "</div></section>";
    }

    function regionCard(item) {
      const event = item.latestEvent;
      const signal = event ? (event.magnitude !== undefined ? "M" + Number(event.magnitude).toFixed(1) + " · " : "") + fmtTime(event.eventTime) : "";
      const eventHtml = event
        ? "<a href=\\"" + escAttr(event.officialUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + esc(event.title) + "</a><div class=\\"micro\\">" + esc(event.sourceLabel) + " · " + esc(signal) + "</div>"
        : "<span class=\\"micro\\">No linked official event yet.</span>";
      const freshness = item.staleGatePassed ? "passed" : stageRank[item.stage] <= 1 ? "blocked old context" : "blocked";
      const blockedCandidate = !item.staleGatePassed && stageRank[item.stage] >= 2;
      const visualStage = blockedCandidate ? item.effectiveStage : item.stage;
      const stageText = blockedCandidate ? "Candidate " + item.stage + " · blocked" : item.stage + " · " + item.stageLabel;
      return "<article class=\\"region " + escAttr(visualStage) + "\\"><div class=\\"region-top\\"><div><div class=\\"region-name\\">" + esc(item.label) + "</div><div class=\\"micro\\">" + esc(item.comparatorOnly ? "Comparison only" : "Target region") + "</div></div><div class=\\"stage " + escAttr(visualStage) + (blockedCandidate ? " blocked" : "") + "\\">" + esc(stageText) + "</div></div>" +
        "<div class=\\"region-summary\\">" + esc(item.operatorSummary) + "</div>" +
        "<div class=\\"region-event\\"><span class=\\"event-label\\">Latest linked official event</span>" + eventHtml + "</div>" +
        "<div class=\\"threshold\\"><span class=\\"threshold-label\\">Configured alert signals</span>" + esc(item.alertThreshold) + "</div>" +
        activityContext(item.activity, item, blockedCandidate) +
        "<div class=\\"region-meta\\"><span>Freshness gate: " + esc(freshness) + "</span><span>Confidence: " + pct(item.confidence) + "</span><span>State: " + esc(item.stageStartedAt ? relative(item.stageStartedAt) : "not recorded") + "</span></div>" +
        "<details class=\\"engine-reason\\"><summary>Engine reason</summary><div>" + esc(item.reason) + "</div></details></article>";
    }

    function activityContext(activity, item, blockedCandidate) {
      if (!activity) {
        return "";
      }
      const counts = activity.sparkline.map((point) => Number(point.count) || 0);
      const maxCount = Math.max(1, ...counts);
      const bars = activity.sparkline.map((point, index) => {
        const height = point.count === 0 ? 3 : Math.max(8, Math.round((point.count / maxCount) * 100));
        const current = index === activity.sparkline.length - 1 ? " current" : "";
        const title = shortDate(point.date) + ": " + point.count + " quake" + (point.count === 1 ? "" : "s") + "/24h";
        return "<span class=\\"spark-bar" + current + "\\" style=\\"height:" + height + "%\\" title=\\"" + escAttr(title) + "\\"></span>";
      }).join("");
      const prior = activity.previousAtOrAbove
        ? shortDate(activity.previousAtOrAbove.endedAt) + " · " + activity.previousAtOrAbove.count + "/24h"
        : "None in " + activity.historyDays + "d";
      const peak = shortDate(activity.recentPeak.endedAt) + " · " + activity.recentPeak.count + "/24h";
      const threshold = activity.absoluteThreshold;
      const thresholdProgress = threshold ? Math.min(100, Math.round((activity.currentCount24h / threshold) * 100)) : 0;
      const thresholdText = threshold ? activity.currentCount24h + " of " + threshold + "/24h" : "Rate only";
      const interpretation = threshold && activity.currentCount24h >= threshold
        ? "At or above the configured absolute swarm-count threshold; review the official event sequence."
        : activity.percentile >= 90
          ? "Elevated relative to the recent USGS catalog, but below the configured absolute swarm threshold."
          : "Within the middle of the recent USGS catalog and below the configured absolute swarm threshold.";
      const references = activity.officialContext.length
        ? "<div class=\\"official-context\\"><span class=\\"threshold-label\\">Official Mount St. Helens comparison points</span>" +
          activity.officialContext.map((reference) =>
            "<div><a href=\\"" + escAttr(reference.officialUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + esc(reference.source + " · " + reference.publishedAt.slice(0, 4)) + "</a><span>" + esc(reference.metric) + "</span></div>"
          ).join("") + "</div>"
        : "";
      const open = stageRank[item.effectiveStage] >= 2 || blockedCandidate ? " open" : "";
      return "<details class=\\"activity\\"" + open + "><summary>Activity context · " + activity.currentCount24h + " earthquakes / 24h</summary><div class=\\"activity-body\\">" +
        "<div class=\\"activity-stats\\">" +
          activityStat(activity.currentCount24h + "/24h", "Current official count" + (activity.currentMaxMagnitude !== undefined ? " · largest M" + Number(activity.currentMaxMagnitude).toFixed(1) : "")) +
          activityStat(activity.percentile + "th", "Percentile vs prior daily windows") +
          activityStat(prior, "Previous window at least this active") +
          activityStat(peak, "Recent " + activity.historyDays + "d peak") +
        "</div>" +
        "<div class=\\"spark-wrap\\"><div class=\\"spark\\" aria-label=\\"" + escAttr(activity.sparkWindowDays + "-day earthquake activity timeline") + "\\">" + bars + "</div><div class=\\"spark-labels\\"><span>" + esc(shortDate(activity.sparkline[0] && activity.sparkline[0].date)) + "</span><span>rolling 24h · USGS M" + esc(Number(activity.catalogMinMagnitude).toFixed(1)) + "+</span><span>Now</span></div></div>" +
        "<div><div class=\\"threshold\\"><span class=\\"threshold-label\\">Absolute swarm threshold · " + esc(thresholdText) + "</span></div><div class=\\"threshold-track\\"><div class=\\"threshold-fill\\" style=\\"width:" + thresholdProgress + "%\\"></div></div></div>" +
        "<p class=\\"activity-read\\">" + esc(interpretation) + "</p>" +
        "<p class=\\"activity-caveat\\">Live and historical counts use the same USGS M" + esc(Number(activity.catalogMinMagnitude).toFixed(1)) + "+ catalog floor. The engine multiplier is current count divided by a floored baseline denominator: " + esc(activity.currentCount24h) + " / max(1, " + esc(Number(activity.baselineCount24h).toFixed(2)) + ") = " + esc(Number(activity.rateMultiple).toFixed(1)) + "x. This is monitoring context, not an eruption probability.</p>" +
        references +
      "</div></details>";
    }

    function activityStat(value, label) {
      return "<div class=\\"activity-stat\\"><div class=\\"activity-value\\">" + esc(value) + "</div><div class=\\"activity-label\\">" + esc(label) + "</div></div>";
    }

    function shortDate(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "n/a";
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    function sources(items) {
      const unhealthy = items.filter((item) => item.status !== "ok");
      const table = tableMarkup(["Source", "Status", "Records", "Last completed", "Age", "Error"], items, (item) => [
        esc(item.label),
        "<span class=\\"source-status " + item.status + "\\">" + esc(item.status) + "</span>",
        esc(item.recordsSeen),
        esc(fmtTime(item.completedAt || item.startedAt)),
        esc(relative(item.completedAt || item.startedAt)),
        esc(item.error || "")
      ]);
      return "<details class=\\"support\\"" + (unhealthy.length ? " open" : "") + "><summary>Official source health <span>" + esc(unhealthy.length ? unhealthy.length + " need attention" : items.length + "/" + items.length + " healthy") + "</span></summary>" + table + "</details>";
    }

    function activeWindows(items) {
      return tableSection("Space-weather context", "open windows; context only, not alerts", ["Trigger", "Ends", "Signals"], items, (item) => [
        esc(item.triggerType),
        esc(fmtTime(item.endsAt)),
        esc([item.kpMax !== undefined ? "Kp " + item.kpMax : "", item.flareClass || "", item.cmeArrivalTime ? "CME " + fmtTime(item.cmeArrivalTime) : ""].filter(Boolean).join(" | ") || "n/a")
      ]);
    }

    function notifications(items) {
      return tableSection("Recent alert output", "latest Slack/dry-run notification records", ["Sent", "Channel", "Alert"], items, (item) => [
        esc(fmtTime(item.sentAt)),
        esc(item.channel),
        "<span class=\\"title-cell\\">" + esc(item.title) + "</span>"
      ]);
    }

    function baselines(items) {
      const table = tableMarkup(["Region", "Window", "Avg/24h", "Samples"], items, (item) => [
        esc(item.label),
        esc(item.windowDays + "d"),
        esc(Number(item.value).toFixed(2)),
        esc(item.sampleCount)
      ]);
      return "<details class=\\"support\\"><summary>Region baselines <span>USGS FDSN backfill context</span></summary>" + table + "</details>";
    }

    function recentEvents(items) {
      return tableSection("Recent target-region events", "official live records linked to monitored regions", ["Event time", "Source", "Region", "Official event", "Signal"], items, eventRow);
    }

    function filteredEvents(items) {
      const table = tableMarkup(["Event time", "Source", "Region", "Official event", "Signal"], items, eventRow);
      return "<details class=\\"support\\"><summary>Filtered official events <span>" + esc(items.length) + " recent records stored but intentionally silent</span></summary>" + (items.length ? table : "<div class=\\"empty\\">No filtered records yet.</div>") + "</details>";
    }

    function comparatorRegion(items) {
      const item = items.find((region) => region.comparatorOnly);
      if (!item) {
        return "<details class=\\"support\\"><summary>Comparator region <span>not configured</span></summary><div class=\\"empty\\">No comparator region is configured.</div></details>";
      }
      return "<details class=\\"support\\"><summary>Comparator region <span>" + esc(item.label) + " · " + esc(item.stage) + "</span></summary><div class=\\"regions\\" style=\\"grid-template-columns:1fr\\">" + regionCard(item) + "</div></details>";
    }

    function eventRow(item) {
      const signal = item.magnitude !== undefined ? "M" + Number(item.magnitude).toFixed(1) : (item.severity || "");
      return [
        esc(fmtTime(item.eventTime)),
        esc(item.sourceLabel),
        esc(item.region || "outside targets"),
        "<a class=\\"title-cell\\" href=\\"" + escAttr(item.officialUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + esc(item.title) + "</a><div class=\\"micro\\">Ingest " + esc(fmtTime(item.ingestTime)) + "</div>",
        esc(signal || "n/a")
      ];
    }

    function tableSection(title, note, headers, items, rowFn) {
      if (!items.length) {
        return "<section><div class=\\"section-head\\"><h2>" + esc(title) + "</h2><span class=\\"section-note\\">" + esc(note) + "</span></div><div class=\\"empty\\">No records yet.</div></section>";
      }
      return "<section><div class=\\"section-head\\"><h2>" + esc(title) + "</h2><span class=\\"section-note\\">" + esc(note) + "</span></div>" + tableMarkup(headers, items, rowFn) + "</section>";
    }

    function tableMarkup(headers, items, rowFn) {
      return "<div class=\\"table-wrap\\"><table><thead><tr>" +
        headers.map((header) => "<th>" + esc(header) + "</th>").join("") +
        "</tr></thead><tbody>" +
        items.map((item) => "<tr>" + rowFn(item).map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>";
    }

    function fmtTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "n/a";
      return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    }

    function relative(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "n/a";
      const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      if (seconds < 90) return seconds + "s ago";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 90) return minutes + "m ago";
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return hours + "h ago";
      return Math.floor(hours / 24) + "d ago";
    }

    function pct(value) {
      return Math.round(Number(value || 0) * 100) + "%";
    }

    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function escAttr(value) {
      return esc(value).replace(new RegExp(String.fromCharCode(96), "g"), "&#96;");
    }

    loadDashboard();
    setInterval(loadDashboard, 30000);
  </script>
</body>
</html>`;
}

function sourceSummaries(
  sourceRuns: SourceRun[],
  events: NormalizedEvent[],
  config: WatcherConfig,
  now: Date
): SourceSummary[] {
  const sourceNames = new Set<string>(SCHEDULED_SOURCES);
  for (const run of sourceRuns) {
    if (OFFICIAL_SOURCES.has(run.source as OfficialSource)) {
      sourceNames.add(run.source);
    }
  }
  for (const event of events) {
    if (OFFICIAL_SOURCES.has(event.source as OfficialSource)) {
      sourceNames.add(event.source);
    }
  }

  const runsBySource = new Map<string, SourceRun[]>();
  for (const run of sourceRuns) {
    runsBySource.set(run.source, [...(runsBySource.get(run.source) ?? []), run]);
  }

  return [...sourceNames]
    .sort((a, b) => sourceSort(a) - sourceSort(b) || a.localeCompare(b))
    .map((source) => {
      const latest = (runsBySource.get(source) ?? []).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
      const staleAfterHours = config.freshness.sourceStaleHours[source as keyof typeof config.freshness.sourceStaleHours] ?? 24;
      if (!latest) {
        return {
          source,
          label: sourceLabel(source),
          status: "missing",
          staleAfterHours,
          recordsSeen: 0,
          error: "no source run recorded"
        };
      }

      const completedOrStarted = latest.completedAt ?? latest.startedAt;
      const ageMinutes = Math.round((now.getTime() - completedOrStarted.getTime()) / 60_000);
      const stale = ageMinutes > staleAfterHours * 60;
      return {
        source,
        label: sourceLabel(source),
        status: latest.status === "error" ? "error" : latest.status === "running" ? "running" : stale ? "stale" : "ok",
        startedAt: latest.startedAt.toISOString(),
        completedAt: latest.completedAt?.toISOString(),
        ageMinutes,
        staleAfterHours,
        recordsSeen: latest.recordsSeen,
        error: latest.error
      };
    });
}

function latestCascadeByRegion(
  states: CascadeState[],
  eventsById: Map<string, NormalizedEvent>
): Map<string, CascadeState> {
  const byRegion = new Map<string, CascadeState>();
  const regions = new Set(
    states
      .filter((state) => state.reason !== "official earthquake outside configured target regions")
      .map((state) => state.region)
  );
  for (const region of regions) {
    const selected = representativeState(
      states.filter(
        (state) =>
          state.region === region &&
          state.reason !== "official earthquake outside configured target regions"
      ),
      eventsById
    );
    if (selected) {
      byRegion.set(region, selected);
    }
  }
  return byRegion;
}

function representativeState(
  states: CascadeState[],
  eventsById: Map<string, NormalizedEvent>
): CascadeState | undefined {
  const latestTime = states
    .map((state) => state.stageStartedAt.getTime())
    .sort((a, b) => b - a)[0];
  if (latestTime === undefined) {
    return undefined;
  }

  return states
    .filter((state) => state.stageStartedAt.getTime() === latestTime)
    .sort((a, b) => {
      if (a.staleGatePassed !== b.staleGatePassed) {
        return a.staleGatePassed ? -1 : 1;
      }
      const stageDifference = stageRank(b.stage) - stageRank(a.stage);
      if (stageDifference !== 0) {
        return stageDifference;
      }
      const eventTimeDifference =
        (eventsById.get(b.latestEventId)?.eventTime.getTime() ?? 0) -
        (eventsById.get(a.latestEventId)?.eventTime.getTime() ?? 0);
      return eventTimeDifference || a.id.localeCompare(b.id);
    })[0];
}

function effectiveStage(state?: CascadeState): CascadeStage {
  if (!state) {
    return "S0";
  }
  if (state.staleGatePassed) {
    return state.stage;
  }
  return state.activeWindowId ? "S1" : "S0";
}

function regionSummary(
  rule: RegionRule,
  state?: CascadeState,
  latestEvent?: NormalizedEvent,
  activity?: RegionActivitySummary
): RegionSummary {
  const qualifiedStage = effectiveStage(state);
  return {
    region: rule.id,
    label: humanizeRegion(rule.id),
    stage: state?.stage ?? "S0",
    effectiveStage: qualifiedStage,
    stageLabel: stageLabel(state?.stage ?? "S0"),
    operatorSummary: regionOperatorSummary(state),
    reason: state?.reason ?? "No recent cascade state recorded for this region.",
    confidence: state?.confidence ?? 0,
    staleGatePassed: state?.staleGatePassed ?? false,
    stageStartedAt: state?.stageStartedAt.toISOString(),
    latestEventId: state?.latestEventId,
    latestEvent: latestEvent ? eventSummary(latestEvent) : undefined,
    activeWindowId: state?.activeWindowId,
    comparatorOnly: rule.id === "CARIBBEAN_VENEZUELA_COMPARATOR",
    alertThreshold: alertThreshold(rule),
    activity
  };
}

function postureSummary(
  regions: RegionSummary[],
  sources: SourceSummary[]
): DashboardData["posture"] {
  const stage = maxRegionStage(regions.filter((region) => !region.comparatorOnly));
  const degradedSources = sources.filter((source) => source.status !== "ok");
  const sourceHealth = degradedSources.length ? "degraded" : "healthy";
  const sourceHealthDetail = degradedSources.length
    ? `${degradedSources.length} official source${degradedSources.length === 1 ? "" : "s"} need attention`
    : `${sources.length}/${sources.length} official sources healthy`;

  const postureByStage: Record<CascadeStage, Omit<DashboardData["posture"], "stage" | "sourceHealth" | "sourceHealthDetail">> = {
    S0: {
      label: "Normal monitoring",
      action: "No action required",
      detail: "No target region has a qualifying official-source signal.",
      tone: "normal"
    },
    S1: {
      label: "Watch only",
      action: "No action required",
      detail: "Space-weather context is active, but no target-region hazard signal has crossed a review threshold.",
      tone: "watch"
    },
    S2: {
      label: "Heightened context",
      action: "Monitor closely",
      detail: "A target-region signal is above baseline but remains below the notification threshold.",
      tone: "watch"
    },
    S3: {
      label: "Elevated watch",
      action: "Review now",
      detail: "A fresh target-region signal crossed the operator-review threshold.",
      tone: "elevated"
    },
    S4: {
      label: "High concern",
      action: "Review now",
      detail: "Confirmed official-source escalation requires immediate operator review.",
      tone: "critical"
    },
    S5: {
      label: "Action alert",
      action: "Check the latest alert",
      detail: "A high-confidence official-source event crossed the live notification threshold.",
      tone: "critical"
    }
  };
  const base = postureByStage[stage];

  return {
    stage,
    ...base,
    action: sourceHealth === "degraded" && stageRank(stage) < 3 ? "Check feed health" : base.action,
    detail:
      sourceHealth === "degraded" && stageRank(stage) < 3
        ? `${base.detail} ${sourceHealthDetail}.`
        : base.detail,
    sourceHealth,
    sourceHealthDetail
  };
}

function latestCycleSummary(
  config: WatcherConfig,
  sourceRuns: SourceRun[],
  events: NormalizedEvent[],
  states: CascadeState[],
  notifications: Array<{ sentAt: Date }>,
  eventsById: Map<string, NormalizedEvent>
): DashboardData["latestCycle"] {
  const scheduledRuns = sourceRuns.filter((run) =>
    SCHEDULED_SOURCES.includes(run.source as (typeof SCHEDULED_SOURCES)[number])
  );
  const latestStartedAt = scheduledRuns
    .map((run) => run.startedAt.getTime())
    .sort((a, b) => b - a)[0];

  if (latestStartedAt === undefined) {
    return {
      officialEventsIngested: 0,
      targetEventsIngested: 0,
      cascadeChecks: 0,
      staleGatePassed: 0,
      alertsSent: 0,
      sourceFailures: [],
      stageChanges: [],
      materialChange: false,
      headline: "Waiting for the first scheduled run",
      detail: "No completed official-source cycle is recorded yet."
    };
  }

  const groupingWindowMs = Math.min(5, Math.max(1, config.pollIntervalMinutes / 2)) * 60_000;
  const cycleRuns = scheduledRuns.filter((run) => latestStartedAt - run.startedAt.getTime() <= groupingWindowMs);
  const cycleStartedAt = new Date(Math.min(...cycleRuns.map((run) => run.startedAt.getTime())));
  const completedTimes = cycleRuns
    .map((run) => run.completedAt?.getTime())
    .filter((time): time is number => time !== undefined);
  const cycleCompletedAt = completedTimes.length ? new Date(Math.max(...completedTimes)) : undefined;
  const cycleEnd = cycleCompletedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const cycleEvents = events.filter(
    (event) => event.ingestTime >= cycleStartedAt && event.ingestTime.getTime() <= cycleEnd + 60_000
  );
  const cycleStates = states.filter(
    (state) => state.stageStartedAt >= cycleStartedAt && state.stageStartedAt.getTime() <= cycleEnd + 60_000
  );
  const cycleNotifications = notifications.filter(
    (notification) => notification.sentAt >= cycleStartedAt && notification.sentAt.getTime() <= cycleEnd + 60_000
  );
  const sourceFailures = cycleRuns
    .filter((run) => run.status === "error")
    .map((run) => sourceLabel(run.source));
  const stageChanges = changedRegionsForCycle(config, states, eventsById, cycleStartedAt, cycleEnd);
  const targetEventsIngested = cycleEvents.filter(
    (event) => event.region && event.region !== "CARIBBEAN_VENEZUELA_COMPARATOR"
  ).length;
  const materialChange =
    targetEventsIngested > 0 || stageChanges.length > 0 || cycleNotifications.length > 0 || sourceFailures.length > 0;

  return {
    startedAt: cycleStartedAt.toISOString(),
    completedAt: cycleCompletedAt?.toISOString(),
    officialEventsIngested: cycleEvents.length,
    targetEventsIngested,
    cascadeChecks: cycleStates.length,
    staleGatePassed: cycleStates.filter((state) => state.staleGatePassed).length,
    alertsSent: cycleNotifications.length,
    sourceFailures,
    stageChanges,
    materialChange,
    headline: materialChange ? "The latest run has items to review" : "No material change in the latest run",
    detail: materialChange
      ? `${targetEventsIngested} new target-region event${targetEventsIngested === 1 ? "" : "s"}, ${stageChanges.length} stage change${stageChanges.length === 1 ? "" : "s"}, ${cycleNotifications.length} alert${cycleNotifications.length === 1 ? "" : "s"}, and ${sourceFailures.length} source failure${sourceFailures.length === 1 ? "" : "s"}.`
      : `${cycleEvents.length} official record${cycleEvents.length === 1 ? "" : "s"} ingested; no target-region stage changes, Slack alerts, or source failures.`
  };
}

function changedRegionsForCycle(
  config: WatcherConfig,
  states: CascadeState[],
  eventsById: Map<string, NormalizedEvent>,
  cycleStartedAt: Date,
  cycleEnd: number
): StageChangeSummary[] {
  return config.regions
    .filter((rule) => rule.id !== "CARIBBEAN_VENEZUELA_COMPARATOR")
    .flatMap((rule) => {
      const regionStates = states.filter((state) => state.region === rule.id);
      const current = representativeState(
        regionStates.filter(
          (state) =>
            state.stageStartedAt >= cycleStartedAt &&
            state.stageStartedAt.getTime() <= cycleEnd + 60_000
        ),
        eventsById
      );
      const previous = representativeState(
        regionStates.filter((state) => state.stageStartedAt < cycleStartedAt),
        eventsById
      );
      const currentStage = effectiveStage(current);
      const previousStage = effectiveStage(previous);
      if (!current || !previous || currentStage === previousStage) {
        return [];
      }
      return [
        {
          region: rule.id,
          label: humanizeRegion(rule.id),
          fromStage: previousStage,
          toStage: currentStage
        }
      ];
    });
}

function regionOperatorSummary(state?: CascadeState): string {
  const stage = state?.stage ?? "S0";
  if (stage === "S0") {
    return "No qualifying official signal.";
  }
  if (stage === "S1" && state?.staleGatePassed) {
    return "Context watch only; no local signal crossed its threshold.";
  }
  if (!state?.staleGatePassed) {
    return `Candidate ${stage} signal blocked because freshness checks did not pass.`;
  }
  const summaries: Record<CascadeStage, string> = {
    S0: "No qualifying official signal.",
    S1: "Context watch only; no local signal crossed its threshold.",
    S2: "Fresh signal above baseline; below the alert threshold.",
    S3: "Fresh target-region signal requires operator review.",
    S4: "Confirmed escalation requires immediate review.",
    S5: "High-confidence event crossed the live alert threshold."
  };
  return summaries[stage];
}

function alertThreshold(rule: RegionRule): string {
  if (rule.id === "CARIBBEAN_VENEZUELA_COMPARATOR") {
    return "Comparison only; stored for baseline context and never alerts.";
  }
  const threshold = rule.alertThresholds;
  const parts = [
    threshold.mMinAlert !== undefined ? `M${threshold.mMinAlert.toFixed(1)}+` : undefined,
    threshold.swarmCount24h !== undefined ? `${threshold.swarmCount24h} quakes/24h` : undefined,
    threshold.swarmRateXBaseline !== undefined ? `${threshold.swarmRateXBaseline}x baseline` : undefined,
    threshold.shallowDepthKmMax !== undefined ? `depth <= ${threshold.shallowDepthKmMax} km` : undefined,
    threshold.tsunamiCheck ? "tsunami check" : undefined,
    threshold.escalateIfHansNotNormal ? "HANS above NORMAL" : undefined
  ].filter((part): part is string => Boolean(part));
  return parts.join(" | ");
}

interface NotableCandidate {
  event: NormalizedEvent;
  period: NotableEventPeriod;
  occurredAt: Date;
  endsAt?: Date;
  category: string;
  metric: string;
  baseScore: number;
  score: number;
  scoreBreakdown: string;
  comparisonKey: string;
  comparisonBasis: string;
}

function mostNotableEvent(
  events: NormalizedEvent[],
  windows: WatchWindow[],
  now: Date
): NotableEventSummary | undefined {
  const earliest = new Date(now.getTime() - 30 * 86_400_000);
  const latest = new Date(now.getTime() + 30 * 86_400_000);
  const activeWindowIds = new Set(
    windows
      .filter((window) => window.active && window.endsAt > now)
      .map((window) => window.triggerEventId)
  );
  const candidates = dedupeNotableEvents(events)
    .flatMap((event) => {
      const candidate = notableCandidate(event, activeWindowIds, now);
      if (
        !candidate ||
        (candidate.occurredAt > now && candidate.period !== "forecast") ||
        candidate.occurredAt < earliest ||
        candidate.occurredAt > latest
      ) {
        return [];
      }
      return [candidate];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        periodRank(b.period) - periodRank(a.period) ||
        b.occurredAt.getTime() - a.occurredAt.getTime()
    );
  const selected = candidates[0];
  if (!selected) {
    return undefined;
  }

  const comparable = candidates.filter(
    (candidate) => candidate.comparisonKey === selected.comparisonKey
  );
  const lowerScoreCount = comparable.filter(
    (candidate) => candidate.baseScore < selected.baseScore
  ).length;
  const equalScoreCount = comparable.filter(
    (candidate) => candidate.baseScore === selected.baseScore
  ).length;
  const rarityPercentile = Math.round(
    ((lowerScoreCount + equalScoreCount / 2) / comparable.length) * 100
  );
  const previousAtOrAbove = comparable
    .filter(
      (candidate) =>
        candidate.event.id !== selected.event.id &&
        candidate.occurredAt.getTime() <=
          selected.occurredAt.getTime() - 86_400_000 &&
        candidate.baseScore >= selected.baseScore
    )
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

  return {
    period: selected.period,
    periodLabel: notablePeriodLabel(selected.period),
    category: selected.category,
    metric: selected.metric,
    score: selected.score,
    rarityPercentile,
    comparableCount: comparable.length,
    occurredAt: selected.occurredAt.toISOString(),
    endsAt: selected.endsAt?.toISOString(),
    event: eventSummary(selected.event),
    selectionReason: `${selected.period === "forecast" ? "Highest-ranked explicit official forecast" : "Highest-ranked official event"} among ${candidates.length} monitored candidates from the last 30 days through the next 30 days.`,
    scoreBreakdown: selected.scoreBreakdown,
    comparisonBasis: `${selected.comparisonBasis} (${comparable.length} comparable record${comparable.length === 1 ? "" : "s"})`,
    previousAtOrAbove: previousAtOrAbove
      ? {
          title: previousAtOrAbove.event.title,
          occurredAt: previousAtOrAbove.occurredAt.toISOString(),
          score: previousAtOrAbove.score,
          officialUrl: previousAtOrAbove.event.officialUrl
        }
      : undefined,
    candidateCount: candidates.length,
    timeline: notableTimeline(candidates, now),
    forecastCoverage:
      "Future candidates require an explicit official onset or arrival time from NWS or NASA DONKI. Earthquakes are not forecast by this card."
  };
}

function dedupeNotableEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const byKey = new Map<string, NormalizedEvent>();
  for (const event of events) {
    if (!OFFICIAL_SOURCES.has(event.source as OfficialSource)) {
      continue;
    }
    const key =
      event.eventType === "earthquake"
        ? `earthquake:${event.externalId}`
        : `${event.source}:${event.externalId}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      (event.source === "usgs_earthquake_geojson" &&
        existing.source === "usgs_fdsn_backfill") ||
      event.sourceUpdatedAt > existing.sourceUpdatedAt
    ) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()];
}

function notableCandidate(
  event: NormalizedEvent,
  activeWindowIds: Set<string>,
  now: Date
): NotableCandidate | undefined {
  const forecastAt = explicitForecastTime(event, now);
  const occurredAt = forecastAt ?? event.eventTime;
  const endsAt = eventEndsAt(event);
  const period: NotableEventPeriod = forecastAt
    ? "forecast"
    : isEventActive(event, activeWindowIds, now, endsAt)
      ? "active"
      : "recent";
  const scored = scoreNotableEvent(event);
  if (!scored) {
    return undefined;
  }
  const periodBonus = period === "active" ? 3 : period === "forecast" ? 2 : 0;
  return {
    event,
    period,
    occurredAt,
    endsAt,
    category: scored.category,
    metric: scored.metric,
    baseScore: scored.score,
    score: Math.min(100, scored.score + periodBonus),
    scoreBreakdown: `${scored.breakdown}${periodBonus ? `; ${period} +${periodBonus}` : ""}.`,
    comparisonKey: scored.comparisonKey,
    comparisonBasis: scored.comparisonBasis
  };
}

function scoreNotableEvent(event: NormalizedEvent):
  | {
      category: string;
      metric: string;
      score: number;
      breakdown: string;
      comparisonKey: string;
      comparisonBasis: string;
    }
  | undefined {
  if (event.eventType === "earthquake" && event.magnitude !== undefined) {
    const magnitude = event.magnitude;
    const score =
      magnitude >= 8
        ? 100
        : magnitude >= 7
          ? Math.round(92 + (magnitude - 7) * 8)
          : magnitude >= 6
            ? Math.round(82 + (magnitude - 6) * 10)
            : magnitude >= 5
              ? Math.round(68 + (magnitude - 5) * 14)
              : magnitude >= 4
                ? Math.round(52 + (magnitude - 4) * 16)
                : Math.max(10, Math.round(10 + magnitude * 14));
    const region = event.region ? humanizeRegion(event.region) : "Global feed";
    return {
      category: "Earthquake",
      metric: `M${magnitude.toFixed(1)}${event.depthKm !== undefined ? ` · ${event.depthKm.toFixed(1)} km deep` : ""}`,
      score: clampScore(score),
      breakdown: `Earthquake magnitude M${magnitude.toFixed(1)} maps to ${clampScore(score)}/100`,
      comparisonKey: `earthquake:${event.region ?? "global"}`,
      comparisonBasis: `${region} earthquake magnitudes`
    };
  }

  if (event.eventType === "weather_alert") {
    const raw = rawObject(event);
    const properties = rawObjectField(raw, "properties");
    const severity = stringValue(properties.severity) ?? "Unknown";
    const certainty = stringValue(properties.certainty) ?? "Unknown";
    const urgency = stringValue(properties.urgency) ?? "Unknown";
    const eventName = stringValue(properties.event) ?? "Weather alert";
    const severityScore: Record<string, number> = {
      Extreme: 94,
      Severe: 80,
      Moderate: 58,
      Minor: 35,
      Unknown: 25
    };
    const eventBonus = /tornado|hurricane|typhoon/i.test(eventName)
      ? 8
      : /tropical storm/i.test(eventName)
        ? 5
        : /flash flood/i.test(eventName)
          ? 4
          : /severe thunderstorm/i.test(eventName)
            ? 2
            : 0;
    const certaintyBonus =
      certainty === "Observed" ? 4 : certainty === "Likely" ? 2 : 0;
    const urgencyBonus =
      urgency === "Immediate" ? 4 : urgency === "Expected" ? 2 : 0;
    const score = clampScore(
      (severityScore[severity] ?? severityScore.Unknown) +
        eventBonus +
        certaintyBonus +
        urgencyBonus
    );
    return {
      category: eventName,
      metric: `${severity} · ${certainty} · ${urgency}`,
      score,
      breakdown: `NWS ${severity} ${severityScore[severity] ?? severityScore.Unknown} + event ${eventBonus} + certainty ${certaintyBonus} + urgency ${urgencyBonus} = ${score}/100`,
      comparisonKey: `nws:${eventName}`,
      comparisonBasis: `NWS ${eventName} alerts`
    };
  }

  if (event.eventType === "natural_event") {
    const raw = rawObject(event);
    const category =
      arrayObjectField(raw, "categories")
        .map((item) => stringValue(item.title))
        .find(Boolean) ?? "Natural event";
    const latestGeometry = arrayObjectField(raw, "geometry").sort(
      (a, b) =>
        dateValueForRanking(b.date) - dateValueForRanking(a.date)
    )[0];
    const magnitude = numberValue(latestGeometry?.magnitudeValue);
    const magnitudeUnit = stringValue(latestGeometry?.magnitudeUnit);
    const categoryScore = eonetCategoryScore(category);
    const magnitudeBonus =
      magnitude !== undefined
        ? Math.min(18, Math.max(0, Math.round(Math.log10(magnitude + 1) * 4)))
        : 0;
    const score = clampScore(categoryScore + magnitudeBonus);
    return {
      category,
      metric:
        magnitude !== undefined
          ? `${formatCompactNumber(magnitude)}${magnitudeUnit ? ` ${magnitudeUnit}` : ""}`
          : "Magnitude not supplied",
      score,
      breakdown: `NASA EONET ${category} base ${categoryScore} + reported-magnitude context ${magnitudeBonus} = ${score}/100`,
      comparisonKey: `eonet:${category}`,
      comparisonBasis: `NASA EONET ${category} events`
    };
  }

  if (event.eventType === "tsunami") {
    const severity = (event.severity ?? "statement").toLowerCase();
    const score = severity.includes("warning")
      ? 98
      : severity.includes("advisory")
        ? 86
        : severity.includes("watch")
          ? 72
          : 35;
    return {
      category: "Tsunami product",
      metric: severity,
      score,
      breakdown: `NOAA tsunami status ${severity} maps to ${score}/100`,
      comparisonKey: "tsunami",
      comparisonBasis: "NOAA tsunami products"
    };
  }

  if (event.eventType === "volcano_notice") {
    const severity = (event.severity ?? "UNKNOWN").toUpperCase();
    const score = /RED|WARNING/.test(severity)
      ? 100
      : /ORANGE|WATCH/.test(severity)
        ? 90
        : /YELLOW|ADVISORY/.test(severity)
          ? 74
          : 30;
    return {
      category: "Volcano status",
      metric: severity,
      score,
      breakdown: `USGS HANS status ${severity} maps to ${score}/100`,
      comparisonKey: `volcano:${event.region ?? event.externalId}`,
      comparisonBasis: "USGS HANS notices for this volcano"
    };
  }

  if (event.eventType === "space_weather") {
    const kp = numberValue(rawObject(event).kp);
    const flareScore = flareNotability(event.severity);
    const score =
      kp !== undefined
        ? clampScore(Math.round(10 + kp * 10))
        : flareScore ?? (/CME|GST|SEP|HSS|IPS/.test(event.severity ?? "") ? 48 : 25);
    return {
      category: "Space weather",
      metric:
        kp !== undefined
          ? `Kp ${kp}`
          : event.severity ?? "Official space-weather event",
      score,
      breakdown: `${kp !== undefined ? `NOAA Kp ${kp}` : `Official ${event.severity ?? "space-weather"} status`} maps to ${score}/100`,
      comparisonKey: `space-weather:${event.source}`,
      comparisonBasis: `${sourceLabel(event.source)} records`
    };
  }

  return undefined;
}

function explicitForecastTime(
  event: NormalizedEvent,
  now: Date
): Date | undefined {
  if (event.eventType === "weather_alert" && event.eventTime > now) {
    return event.eventTime;
  }
  if (event.source !== "nasa_donki") {
    return undefined;
  }
  const raw = rawObject(event);
  const arrivals = arrayObjectField(raw, "cmeAnalyses")
    .flatMap((analysis) => arrayObjectField(analysis, "enlilList"))
    .filter((enlil) => enlil.isEarthGB === true)
    .flatMap((enlil) => {
      const date = parseRankingDate(enlil.estimatedShockArrivalTime);
      return date && date > now ? [date] : [];
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return arrivals[0];
}

function eventEndsAt(event: NormalizedEvent): Date | undefined {
  if (event.eventType === "weather_alert") {
    const properties = rawObjectField(rawObject(event), "properties");
    return (
      parseRankingDate(properties.ends) ??
      parseRankingDate(properties.expires)
    );
  }
  if (event.eventType === "natural_event") {
    return parseRankingDate(rawObject(event).closed);
  }
  return undefined;
}

function isEventActive(
  event: NormalizedEvent,
  activeWindowIds: Set<string>,
  now: Date,
  endsAt?: Date
): boolean {
  if (event.eventType === "weather_alert") {
    return event.eventTime <= now && Boolean(endsAt && endsAt > now);
  }
  if (event.eventType === "natural_event") {
    return rawObject(event).closed === null;
  }
  if (event.eventType === "space_weather") {
    return activeWindowIds.has(event.id);
  }
  if (event.eventType === "tsunami") {
    return (
      /warning|advisory|watch/i.test(event.severity ?? "") &&
      event.eventTime >= hoursAgo(now, 6)
    );
  }
  return false;
}

function notableTimeline(
  candidates: NotableCandidate[],
  now: Date
): NotableTimelinePoint[] {
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 30
    )
  );
  const byDay = new Map<string, NotableCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.occurredAt.toISOString().slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), candidate]);
  }
  return Array.from({ length: 61 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    const dayCandidates = byDay.get(date.toISOString().slice(0, 10)) ?? [];
    return {
      date: date.toISOString(),
      eventCount: dayCandidates.length,
      maxScore: dayCandidates.length
        ? Math.max(...dayCandidates.map((candidate) => candidate.score))
        : 0
    };
  });
}

function rawObject(event: NormalizedEvent): Record<string, unknown> {
  return event.rawJson && typeof event.rawJson === "object"
    ? (event.rawJson as Record<string, unknown>)
    : {};
}

function rawObjectField(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const value = obj[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayObjectField(
  obj: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  const value = obj[field];
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseRankingDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateValueForRanking(value: unknown): number {
  return parseRankingDate(value)?.getTime() ?? 0;
}

function eonetCategoryScore(category: string): number {
  const lower = category.toLowerCase();
  if (lower.includes("severe storm")) return 76;
  if (lower.includes("volcano")) return 74;
  if (lower.includes("flood")) return 70;
  if (lower.includes("landslide")) return 68;
  if (lower.includes("wildfire")) return 60;
  if (lower.includes("drought")) return 58;
  if (lower.includes("dust")) return 52;
  return 45;
}

function flareNotability(severity?: string): number | undefined {
  const match = severity?.toUpperCase().match(/^([CMX])([0-9]+(?:\.[0-9]+)?)/);
  if (!match) {
    return undefined;
  }
  const value = Number(match[2]);
  return match[1] === "X"
    ? clampScore(Math.round(86 + value * 4))
    : match[1] === "M"
      ? clampScore(Math.round(62 + value * 2))
      : clampScore(Math.round(38 + value));
}

function notablePeriodLabel(period: NotableEventPeriod): string {
  return period === "active"
    ? "Active now"
    : period === "forecast"
      ? "Explicit official forecast"
      : "Occurred in the last 30 days";
}

function periodRank(period: NotableEventPeriod): number {
  return period === "active" ? 2 : period === "forecast" ? 1 : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function regionActivitySummaries(
  config: WatcherConfig,
  events: NormalizedEvent[],
  baselines: RegionBaseline[],
  now: Date
): Map<string, RegionActivitySummary> {
  const result = new Map<string, RegionActivitySummary>();
  const earthquakeEvents = dedupeEarthquakeEvents(
    events,
    config.baselineMinMagnitude
  );

  for (const rule of config.regions) {
    if (rule.id === "CARIBBEAN_VENEZUELA_COMPARATOR") {
      continue;
    }
    const baseline = baselines
      .filter(
        (item) =>
          item.region === rule.id &&
          item.metric === "earthquakes_count_24h"
      )
      .sort(
        (a, b) =>
          b.windowDays - a.windowDays ||
          b.computedAt.getTime() - a.computedAt.getTime()
      )[0];
    if (!baseline) {
      continue;
    }

    const historyDays = Math.max(1, baseline.windowDays);
    const sparkWindowDays = Math.min(90, historyDays);
    const historyStart = new Date(now.getTime() - historyDays * 86_400_000);
    const regionEvents = earthquakeEvents
      .filter(
        (event) =>
          event.region === rule.id &&
          event.eventTime >= historyStart &&
          event.eventTime <= now
      )
      .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
    const sparkline = Array.from({ length: sparkWindowDays }, (_, index) => {
      const endedAt = new Date(
        now.getTime() - (sparkWindowDays - index - 1) * 86_400_000
      );
      const windowEvents = eventsInTrailingDay(regionEvents, endedAt);
      return {
        date: endedAt.toISOString(),
        count: windowEvents.length,
        maxMagnitude: maximumMagnitude(windowEvents)
      };
    });
    const current: ActivityPoint = sparkline.at(-1) ?? {
      date: now.toISOString(),
      count: 0
    };
    const historicalSamples = sparkline.slice(0, -1);
    const percentile = historicalSamples.length
      ? Math.round(
          (historicalSamples.filter((point) => point.count <= current.count)
            .length /
            historicalSamples.length) *
            100
        )
      : 0;
    const priorWindowEnds = regionEvents
      .filter(
        (event) =>
          event.eventTime.getTime() <= now.getTime() - 86_400_000
      )
      .sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime())
      .map((event) => ({
        endedAt: event.eventTime.toISOString(),
        count: countEventsInTrailingDay(regionEvents, event.eventTime)
      }));
    const previousAtOrAbove =
      current.count > 0
        ? priorWindowEnds.find((point) => point.count >= current.count)
        : undefined;
    const recentPeak =
      [...priorWindowEnds].sort(
        (a, b) =>
          b.count - a.count ||
          new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
      )[0] ?? {
        endedAt: new Date(now.getTime() - 86_400_000).toISOString(),
        count: 0
      };

    result.set(rule.id, {
      historyDays,
      sparkWindowDays,
      catalogMinMagnitude: config.baselineMinMagnitude,
      currentCount24h: current.count,
      currentMaxMagnitude: current.maxMagnitude,
      baselineCount24h: baseline.value,
      rateMultiple: current.count / Math.max(1, baseline.value),
      percentile,
      previousAtOrAbove,
      recentPeak,
      absoluteThreshold: rule.alertThresholds.swarmCount24h,
      sparkline,
      officialContext: officialContextForRegion(rule.id)
    });
  }

  return result;
}

function dedupeEarthquakeEvents(
  events: NormalizedEvent[],
  minMagnitude: number
): NormalizedEvent[] {
  const byExternalId = new Map<string, NormalizedEvent>();
  for (const event of events) {
    if (
      event.eventType !== "earthquake" ||
      event.magnitude === undefined ||
      event.magnitude < minMagnitude ||
      !OFFICIAL_SOURCES.has(event.source as OfficialSource)
    ) {
      continue;
    }
    const existing = byExternalId.get(event.externalId);
    if (!existing || preferActivityEvent(event, existing)) {
      byExternalId.set(event.externalId, event);
    }
  }
  return [...byExternalId.values()];
}

function preferActivityEvent(
  candidate: NormalizedEvent,
  existing: NormalizedEvent
): boolean {
  const candidateLive = candidate.source === "usgs_earthquake_geojson";
  const existingLive = existing.source === "usgs_earthquake_geojson";
  if (candidateLive !== existingLive) {
    return candidateLive;
  }
  return candidate.sourceUpdatedAt > existing.sourceUpdatedAt;
}

function eventsInTrailingDay(
  events: NormalizedEvent[],
  endedAt: Date
): NormalizedEvent[] {
  const startedAt = endedAt.getTime() - 86_400_000;
  const startIndex = firstEventAfter(events, startedAt);
  const endIndex = firstEventAfter(events, endedAt.getTime());
  return events.slice(startIndex, endIndex);
}

function countEventsInTrailingDay(
  events: NormalizedEvent[],
  endedAt: Date
): number {
  const startedAt = endedAt.getTime() - 86_400_000;
  return (
    firstEventAfter(events, endedAt.getTime()) -
    firstEventAfter(events, startedAt)
  );
}

function firstEventAfter(events: NormalizedEvent[], timestamp: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].eventTime.getTime() <= timestamp) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function maximumMagnitude(events: NormalizedEvent[]): number | undefined {
  const magnitudes = events
    .map((event) => event.magnitude)
    .filter((magnitude): magnitude is number => magnitude !== undefined);
  return magnitudes.length ? Math.max(...magnitudes) : undefined;
}

function officialContextForRegion(region: string): OfficialContextReference[] {
  if (region !== "CASCADE_VOLCANOES_ST_HELENS") {
    return [];
  }
  return [
    {
      title: "Mount St. Helens seismicity remained within background levels",
      source: "USGS Cascades Volcano Observatory",
      publishedAt: "2024-06-21",
      metric: "Peak 38 earthquakes/week; more than 95% were below M1; alert level remained NORMAL.",
      officialUrl:
        "https://www.usgs.gov/observatories/cvo/news/mount-st-helens-seismicity-elevated-within-range-background-levels-february"
    },
    {
      title: "2023 earthquake uptick remained within background levels",
      source: "USGS Cascades Volcano Observatory",
      publishedAt: "2023-10-20",
      metric: "Peak 40-50 earthquakes/week; no signs of an imminent eruption.",
      officialUrl:
        "https://www.usgs.gov/observatories/cvo/news/uptick-earthquake-activity-mount-st-helens-remains-within-background-levels"
    }
  ];
}

function eventSummary(event: NormalizedEvent): EventSummary {
  return {
    id: event.id,
    source: event.source,
    sourceLabel: sourceLabel(event.source),
    externalId: event.externalId,
    eventType: event.eventType,
    region: event.region,
    title: event.title,
    eventTime: event.eventTime.toISOString(),
    sourceUpdatedAt: event.sourceUpdatedAt.toISOString(),
    ingestTime: event.ingestTime.toISOString(),
    magnitude: event.magnitude,
    depthKm: event.depthKm,
    lat: event.lat,
    lon: event.lon,
    severity: event.severity,
    officialUrl: event.officialUrl
  };
}

function windowSummary(window: WatchWindow): WindowSummary {
  return {
    id: window.id,
    triggerEventId: window.triggerEventId,
    triggerType: window.triggerType,
    startedAt: window.startedAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    active: window.active,
    kpMax: window.kpMax,
    flareClass: window.flareClass,
    cmeArrivalTime: window.cmeArrivalTime?.toISOString(),
    score: window.score
  };
}

function baselineSummary(baseline: RegionBaseline): BaselineSummary {
  return {
    region: baseline.region,
    label: humanizeRegion(baseline.region),
    metric: baseline.metric,
    windowDays: baseline.windowDays,
    computedAt: baseline.computedAt.toISOString(),
    value: baseline.value,
    sampleCount: baseline.sampleCount
  };
}

function pipelineSummary(
  config: WatcherConfig,
  sourceRuns: SourceRun[],
  statesLast24h: CascadeState[],
  notifications: Array<{ sentAt: Date }>,
  now: Date
): DashboardData["pipeline"] {
  const sourceHealth = sourceSummaries(sourceRuns, [], config, now);
  const errorSources = sourceHealth.filter((source) => source.status === "error" || source.status === "missing");
  const staleSources = sourceHealth.filter((source) => source.status === "stale");
  const staleGateTotal = statesLast24h.length;
  const staleGatePassed = statesLast24h.filter((state) => state.staleGatePassed).length;
  const latestNotification = notifications.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];

  return [
    {
      step: "Official ingestion",
      status: errorSources.length ? "warn" : staleSources.length ? "watch" : "ok",
      detail: errorSources.length
        ? `${errorSources.length} source(s) missing or errored.`
        : staleSources.length
          ? `${staleSources.length} source(s) are stale relative to configured freshness.`
          : "Scheduled official feeds have recent successful source-run records."
    },
    {
      step: "Stale gate",
      status: staleGateTotal === 0 ? "watch" : "ok",
      detail:
        staleGateTotal === 0
          ? "No cascade checks recorded in the last 24 hours."
          : `${staleGatePassed}/${staleGateTotal} cascade checks passed in the last 24 hours; the rest were suppressed before notification.`
    },
    {
      step: "Cascade scorer",
      status: statesLast24h.some((state) => stageRank(state.stage) >= 3) ? "watch" : "ok",
      detail: statesLast24h.length
        ? `${statesLast24h.length} cascade states written in the last 24 hours.`
        : "No recent cascade state writes."
    },
    {
      step: "Notification gate",
      status: config.dryRun ? "watch" : "ok",
      detail: config.dryRun
        ? "Dry-run mode: alerts are logged but not posted."
        : latestNotification
          ? `Live mode. Last notification record: ${latestNotification.sentAt.toISOString()}.`
          : "Live mode. No notification records found yet."
    }
  ];
}

function notificationChannel(config: WatcherConfig): DashboardData["system"]["notificationChannel"] {
  if (config.dryRun) {
    return "dry_run";
  }
  if (config.slackBotToken && config.slackChannelId) {
    return "slack_bot";
  }
  if (config.notifyWebhookUrl) {
    return "webhook";
  }
  return "unconfigured";
}

function maxRegionStage(regions: RegionSummary[]): CascadeStage {
  return regions
    .map((region) => region.effectiveStage)
    .sort((a, b) => stageRank(b) - stageRank(a))[0] ?? "S0";
}

function maxIso(dates: Array<Date | undefined>): string | undefined {
  const time = dates
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime())
    .sort((a, b) => b - a)[0];
  return time === undefined ? undefined : new Date(time).toISOString();
}

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

function stageRank(stage: CascadeStage): number {
  return Number(stage.slice(1));
}

function stageLabel(stage: CascadeStage): string {
  const labels: Record<CascadeStage, string> = {
    S0: "Normal",
    S1: "Watch",
    S2: "Heightened",
    S3: "Elevated",
    S4: "High concern",
    S5: "Action"
  };
  return labels[stage];
}

function humanizeRegion(region: string): string {
  const labels: Record<string, string> = {
    CASCADE_VOLCANOES_RAINIER: "Mount Rainier",
    CASCADE_VOLCANOES_ST_HELENS: "Mount St. Helens",
    CASCADE_VOLCANOES_HOOD_ADAMS_BAKER: "Mount Hood / Adams / Baker",
    YELLOWSTONE: "Yellowstone",
    NORCAL_OFFSHORE_MENDOCINO_BLANCO: "Mendocino / Blanco Offshore",
    PNW_CASCADIA_OFFSHORE: "Cascadia Offshore (PNW)",
    WESTERN_WA_SEATTLE_WHIDBEY: "Western Washington / Seattle / Whidbey",
    CALIFORNIA_FAULTS: "California Faults",
    CARIBBEAN_VENEZUELA_COMPARATOR: "Caribbean / Venezuela Comparator"
  };
  if (labels[region]) {
    return labels[region];
  }
  return region
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    usgs_earthquake_geojson: "USGS earthquakes",
    usgs_fdsn_backfill: "USGS FDSN backfill",
    usgs_hans: "USGS HANS volcanoes",
    swpc_kp: "NOAA/SWPC Kp",
    swpc_goes_xray: "NOAA/SWPC GOES X-ray",
    swpc_solar_wind: "NOAA/SWPC solar wind",
    swpc_alerts: "NOAA/SWPC alerts",
    nasa_donki: "NASA DONKI",
    nasa_eonet: "NASA EONET",
    nws_alerts: "NOAA/NWS alerts",
    tsunami_ntwc: "NOAA NTWC tsunami",
    tsunami_ptwc: "NOAA PTWC tsunami"
  };
  return labels[source] ?? source;
}

function sourceSort(source: string): number {
  const index = SCHEDULED_SOURCES.indexOf(source as (typeof SCHEDULED_SOURCES)[number]);
  return index === -1 ? 100 : index;
}
