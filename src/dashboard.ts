import { DEFAULT_CONFIG, OFFICIAL_SOURCES, type WatcherConfig } from "./config.js";
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
  reason: string;
  confidence: number;
  staleGatePassed: boolean;
  stageStartedAt?: string;
  latestEventId?: string;
  activeWindowId?: string;
  comparatorOnly: boolean;
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
  const cascadeByRegion = latestCascadeByRegion(cascadeStates);
  const regions = config.regions.map((rule) => regionSummary(rule.id, cascadeByRegion.get(rule.id)));
  const latestRunCompletedAt = maxIso(sourceRuns.map((run) => run.completedAt));
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
    sources: sourceSummaries(sourceRuns, liveEvents, config, now),
    regions,
    activeWindows: activeWindows.map(windowSummary),
    recentEvents: liveEvents.slice(0, 24).map(eventSummary),
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
      --bg: #f6f7f4;
      --panel: #ffffff;
      --ink: #17211b;
      --muted: #667064;
      --line: #dfe5dc;
      --ok: #167244;
      --watch: #a05f00;
      --warn: #b42318;
      --soft-ok: #e7f5ed;
      --soft-watch: #fff2d6;
      --soft-warn: #fdebea;
      --accent: #275d50;
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
    .shell { max-width: 1480px; margin: 0 auto; padding: 20px; }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      padding: 18px 0 14px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 28px; line-height: 1.1; letter-spacing: 0; }
    .subhead { margin: 8px 0 0; max-width: 900px; color: var(--muted); line-height: 1.45; }
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
    main { display: grid; gap: 18px; padding-top: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(6, minmax(145px, 1fr)); gap: 12px; }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-height: 96px;
    }
    .metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { margin-top: 8px; font-size: 24px; font-weight: 750; line-height: 1.1; }
    .metric .note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .grid-2 { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr); gap: 18px; align-items: start; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
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
    .regions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 14px; }
    .region {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      min-height: 150px;
      display: grid;
      gap: 8px;
      align-content: start;
    }
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
    }
    .stage.S0 { background: var(--stage0); }
    .stage.S1 { background: var(--stage1); }
    .stage.S2 { background: var(--stage2); }
    .stage.S3 { background: var(--stage3); }
    .stage.S4 { background: var(--stage4); }
    .stage.S5 { background: var(--stage5); }
    .reason { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .micro { color: var(--muted); font-size: 12px; line-height: 1.35; }
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
    @media (max-width: 1120px) {
      .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .regions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 680px) {
      .shell { padding: 14px; }
      header { grid-template-columns: 1fr; }
      .statusbar { justify-content: flex-start; }
      .metrics, .pipeline, .regions { grid-template-columns: 1fr; }
      h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Geospace Watcher</h1>
        <p class="subhead">Live engine view for the official-source geohazard watcher: ingestion, stale gate, cascade scoring, watch windows, and notification output.</p>
      </div>
      <div id="statusbar" class="statusbar"></div>
    </header>
    <div id="app" class="loading">Loading live watcher state...</div>
    <footer>Read-only dashboard. Data comes from persisted official-source records in Cloud SQL. Auto-refreshes every 30 seconds.</footer>
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
        pill("Refresh " + data.system.pollIntervalMinutes + " min", "watch"),
        pill("Updated " + fmtTime(data.generatedAt), "")
      ].join("");

      app.className = "";
      app.innerHTML = [
        metrics(data),
        pipeline(data.pipeline),
        "<div class=\\"grid-2\\">" + regions(data.regions) + sources(data.sources) + "</div>",
        "<div class=\\"grid-3\\">" + activeWindows(data.activeWindows) + notifications(data.recentNotifications) + baselines(data.baselines) + "</div>",
        recentEvents(data.recentEvents),
        filteredEvents(data.filteredOfficialEvents)
      ].join("");
    }

    function pill(text, cls) {
      return "<span class=\\"pill " + cls + "\\">" + esc(text) + "</span>";
    }

    function metrics(data) {
      const s = data.summary;
      return "<div class=\\"metrics\\">" +
        metric("Current max stage", s.maxCurrentStage, "Highest latest stage across configured regions") +
        metric("Events / 24h", s.eventsLast24h, "Live official-source events, excluding backfill") +
        metric("Notifications / 24h", s.notificationsLast24h, data.system.notificationChannel) +
        metric("Active windows", s.activeWindows, "Space-weather watch windows still open") +
        metric("Stale gate", s.staleGatePassedLast24h + " / " + s.staleGateCheckedLast24h, "Passed checks; failed checks are suppressed before notification") +
        metric("Last ingest", relative(s.latestIngestAt), fmtTime(s.latestIngestAt)) +
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
      return "<section><div class=\\"section-head\\"><h2>Configured region stages</h2><span class=\\"section-note\\">latest persisted cascade state</span></div><div class=\\"regions\\">" +
        items.map((item) => "<div class=\\"region\\"><div class=\\"region-top\\"><div><div class=\\"region-name\\">" + esc(item.label) + "</div><div class=\\"micro\\">" + esc(item.comparatorOnly ? "Comparator only" : "Target region") + "</div></div><div class=\\"stage " + item.stage + "\\">" + item.stage + "</div></div><div class=\\"reason\\">" + esc(item.reason) + "</div><div class=\\"micro\\">Confidence " + pct(item.confidence) + " | Stale gate " + esc(item.staleGatePassed ? "passed" : "not passed") + "</div><div class=\\"micro\\">" + esc(item.stageStartedAt ? fmtTime(item.stageStartedAt) : "No state yet") + "</div></div>").join("") +
      "</div></section>";
    }

    function sources(items) {
      return tableSection("Official source freshness", "latest source_runs rows", ["Source", "Status", "Records", "Completed", "Age", "Error"], items, (item) => [
        esc(item.label),
        "<span class=\\"source-status " + item.status + "\\">" + esc(item.status) + "</span>",
        esc(item.recordsSeen),
        esc(fmtTime(item.completedAt || item.startedAt)),
        esc(relative(item.completedAt || item.startedAt)),
        esc(item.error || "")
      ]);
    }

    function activeWindows(items) {
      return tableSection("Active watch windows", "space-weather S1 context", ["Trigger", "Ends", "Signals"], items, (item) => [
        esc(item.triggerType),
        esc(fmtTime(item.endsAt)),
        esc([item.kpMax !== undefined ? "Kp " + item.kpMax : "", item.flareClass || "", item.cmeArrivalTime ? "CME " + fmtTime(item.cmeArrivalTime) : ""].filter(Boolean).join(" | ") || "n/a")
      ]);
    }

    function notifications(items) {
      return tableSection("Recent notifications", "Slack/dry-run dedupe records", ["Sent", "Channel", "Title"], items, (item) => [
        esc(fmtTime(item.sentAt)),
        esc(item.channel),
        "<span class=\\"title-cell\\">" + esc(item.title) + "</span>"
      ]);
    }

    function baselines(items) {
      return tableSection("Region baselines", "USGS FDSN backfill context", ["Region", "Window", "Avg/24h", "Samples"], items, (item) => [
        esc(item.label),
        esc(item.windowDays + "d"),
        esc(Number(item.value).toFixed(2)),
        esc(item.sampleCount)
      ]);
    }

    function recentEvents(items) {
      return tableSection("Recent official events", "live source records, not backfill", ["Time", "Source", "Region", "Event", "M/Status"], items, eventRow);
    }

    function filteredEvents(items) {
      return tableSection("Filtered official events", "stored but intentionally silent", ["Time", "Source", "Region", "Event", "M/Status"], items, eventRow);
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
      return "<section><div class=\\"section-head\\"><h2>" + esc(title) + "</h2><span class=\\"section-note\\">" + esc(note) + "</span></div><div class=\\"table-wrap\\"><table><thead><tr>" +
        headers.map((header) => "<th>" + esc(header) + "</th>").join("") +
        "</tr></thead><tbody>" +
        items.map((item) => "<tr>" + rowFn(item).map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div></section>";
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

function regionSummary(region: string, state?: CascadeState): RegionSummary {
  return {
    region,
    label: humanizeRegion(region),
    stage: state?.stage ?? "S0",
    reason: state?.reason ?? "No recent cascade state recorded for this region.",
    confidence: state?.confidence ?? 0,
    staleGatePassed: state?.staleGatePassed ?? false,
    stageStartedAt: state?.stageStartedAt.toISOString(),
    latestEventId: state?.latestEventId,
    activeWindowId: state?.activeWindowId,
    comparatorOnly: region === "CARIBBEAN_VENEZUELA_COMPARATOR"
  };
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

function humanizeRegion(region: string): string {
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
