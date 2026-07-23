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

interface StageChangeSummary {
  region: string;
  label: string;
  fromStage: CascadeStage;
  toStage: CascadeStage;
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
  const eventsById = new Map(liveEvents.map((event) => [event.id, event]));
  const cascadeByRegion = latestCascadeByRegion(cascadeStates);
  const regions = config.regions.map((rule) => {
    const state = cascadeByRegion.get(rule.id);
    return regionSummary(rule, state, state ? eventsById.get(state.latestEventId) : undefined);
  });
  const sources = sourceSummaries(sourceRuns, liveEvents, config, now);
  const latestCycle = latestCycleSummary(config, sourceRuns, liveEvents, cascadeStates, notifications);
  const posture = postureSummary(regions, sources);
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
        .sort((a, b) => stageRank[b.stage] - stageRank[a.stage] || String(a.label).localeCompare(String(b.label)));
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
      return "<article class=\\"region " + escAttr(item.stage) + "\\"><div class=\\"region-top\\"><div><div class=\\"region-name\\">" + esc(item.label) + "</div><div class=\\"micro\\">" + esc(item.comparatorOnly ? "Comparison only" : "Target region") + "</div></div><div class=\\"stage " + escAttr(item.stage) + "\\">" + esc(item.stage) + " · " + esc(item.stageLabel) + "</div></div>" +
        "<div class=\\"region-summary\\">" + esc(item.operatorSummary) + "</div>" +
        "<div class=\\"region-event\\"><span class=\\"event-label\\">Latest linked official event</span>" + eventHtml + "</div>" +
        "<div class=\\"threshold\\"><span class=\\"threshold-label\\">Configured alert signals</span>" + esc(item.alertThreshold) + "</div>" +
        "<div class=\\"region-meta\\"><span>Freshness gate: " + esc(freshness) + "</span><span>Confidence: " + pct(item.confidence) + "</span><span>State: " + esc(item.stageStartedAt ? relative(item.stageStartedAt) : "not recorded") + "</span></div>" +
        "<details class=\\"engine-reason\\"><summary>Engine reason</summary><div>" + esc(item.reason) + "</div></details></article>";
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

function latestCascadeByRegion(states: CascadeState[]): Map<string, CascadeState> {
  const byRegion = new Map<string, CascadeState>();
  const targetStates = states
    .filter((state) => state.reason !== "official earthquake outside configured target regions")
    .sort((a, b) => b.stageStartedAt.getTime() - a.stageStartedAt.getTime());
  for (const state of targetStates) {
    if (!byRegion.has(state.region)) {
      byRegion.set(state.region, state);
    }
  }
  return byRegion;
}

function regionSummary(rule: RegionRule, state?: CascadeState, latestEvent?: NormalizedEvent): RegionSummary {
  return {
    region: rule.id,
    label: humanizeRegion(rule.id),
    stage: state?.stage ?? "S0",
    stageLabel: stageLabel(state?.stage ?? "S0"),
    operatorSummary: regionOperatorSummary(state?.stage ?? "S0", state?.staleGatePassed ?? false),
    reason: state?.reason ?? "No recent cascade state recorded for this region.",
    confidence: state?.confidence ?? 0,
    staleGatePassed: state?.staleGatePassed ?? false,
    stageStartedAt: state?.stageStartedAt.toISOString(),
    latestEventId: state?.latestEventId,
    latestEvent: latestEvent ? eventSummary(latestEvent) : undefined,
    activeWindowId: state?.activeWindowId,
    comparatorOnly: rule.id === "CARIBBEAN_VENEZUELA_COMPARATOR",
    alertThreshold: alertThreshold(rule)
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
  notifications: Array<{ sentAt: Date }>
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
  const stageChanges = changedRegionsForCycle(config, states, cycleStartedAt, cycleEnd);
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
  cycleStartedAt: Date,
  cycleEnd: number
): StageChangeSummary[] {
  return config.regions
    .filter((rule) => rule.id !== "CARIBBEAN_VENEZUELA_COMPARATOR")
    .flatMap((rule) => {
      const regionStates = states
        .filter((state) => state.region === rule.id)
        .sort((a, b) => a.stageStartedAt.getTime() - b.stageStartedAt.getTime());
      const current = regionStates
        .filter(
          (state) => state.stageStartedAt >= cycleStartedAt && state.stageStartedAt.getTime() <= cycleEnd + 60_000
        )
        .at(-1);
      const previous = regionStates.filter((state) => state.stageStartedAt < cycleStartedAt).at(-1);
      if (!current || !previous || current.stage === previous.stage) {
        return [];
      }
      return [
        {
          region: rule.id,
          label: humanizeRegion(rule.id),
          fromStage: previous.stage,
          toStage: current.stage
        }
      ];
    });
}

function regionOperatorSummary(stage: CascadeStage, staleGatePassed: boolean): string {
  if (stage === "S0") {
    return "No qualifying official signal.";
  }
  if (stage === "S1") {
    return "Context watch only; no local signal crossed its threshold.";
  }
  if (!staleGatePassed) {
    return "Signal suppressed because freshness checks did not pass.";
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
    .map((region) => region.stage)
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
    tsunami_ntwc: "NOAA NTWC tsunami",
    tsunami_ptwc: "NOAA PTWC tsunami"
  };
  return labels[source] ?? source;
}

function sourceSort(source: string): number {
  const index = SCHEDULED_SOURCES.indexOf(source as (typeof SCHEDULED_SOURCES)[number]);
  return index === -1 ? 100 : index;
}
