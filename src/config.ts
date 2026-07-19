import type { OfficialSource, RegionId } from "./types.js";

export interface RegionThresholds {
  mMinAlert?: number;
  populationCenterMMin?: number;
  swarmCount24h?: number;
  swarmRateXBaseline?: number;
  shallowDepthKmMax?: number;
  tsunamiCheck?: boolean;
  escalateIfHansNotNormal?: boolean;
}

export interface RegionRule {
  id: RegionId;
  center?: [lat: number, lon: number];
  radiusKm?: number;
  bbox?: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  alertThresholds: RegionThresholds;
}

export interface WatcherConfig {
  dryRun: boolean;
  pollIntervalMinutes: number;
  nasaApiKey?: string;
  notifyWebhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
  freshness: {
    maxEventAgeHours: number;
    sourceStaleHours: Record<OfficialSource, number>;
  };
  spaceWeather: {
    watchWindowHours: number[];
    s1Triggers: {
      kpG1: number;
      kpG2: number;
      flareMinClass: string;
      flareHighClass: string;
      cmeArrivalRequiredForCmeStage: boolean;
      protonDensitySpikeRatio: number;
      bzSouthNt: number;
    };
  };
  regions: RegionRule[];
  notifier: {
    minStageToNotify: "S3";
    alwaysNotify: string[];
    suppressDuplicateHours: number;
  };
}

export const OFFICIAL_SOURCES = new Set<OfficialSource>([
  "usgs_earthquake_geojson",
  "usgs_fdsn_backfill",
  "usgs_hans",
  "swpc_kp",
  "swpc_goes_xray",
  "swpc_solar_wind",
  "swpc_alerts",
  "nasa_donki",
  "tsunami_ntwc",
  "tsunami_ptwc"
]);

export const DEFAULT_CONFIG: WatcherConfig = {
  dryRun: true,
  pollIntervalMinutes: 15,
  freshness: {
    maxEventAgeHours: 12,
    sourceStaleHours: {
      usgs_earthquake_geojson: 2,
      usgs_fdsn_backfill: 24,
      usgs_hans: 24,
      swpc_kp: 2,
      swpc_goes_xray: 1,
      swpc_solar_wind: 1,
      swpc_alerts: 2,
      nasa_donki: 12,
      tsunami_ntwc: 2,
      tsunami_ptwc: 2
    }
  },
  spaceWeather: {
    watchWindowHours: [6, 24, 72],
    s1Triggers: {
      kpG1: 5,
      kpG2: 6,
      flareMinClass: "M5",
      flareHighClass: "X1",
      cmeArrivalRequiredForCmeStage: true,
      protonDensitySpikeRatio: 2,
      bzSouthNt: -10
    }
  },
  regions: [
    {
      id: "CASCADE_VOLCANOES_RAINIER",
      center: [46.8523, -121.7603],
      radiusKm: 25,
      alertThresholds: {
        mMinAlert: 3.5,
        swarmCount24h: 50,
        swarmRateXBaseline: 4,
        shallowDepthKmMax: 8,
        escalateIfHansNotNormal: true
      }
    },
    {
      id: "CASCADE_VOLCANOES_ST_HELENS",
      center: [46.1912, -122.1944],
      radiusKm: 25,
      alertThresholds: {
        mMinAlert: 3,
        swarmCount24h: 30,
        swarmRateXBaseline: 3,
        shallowDepthKmMax: 8,
        escalateIfHansNotNormal: true
      }
    },
    {
      id: "CASCADE_VOLCANOES_HOOD_ADAMS_BAKER",
      bbox: [-122.5, 44.0, -120.5, 49.2],
      alertThresholds: {
        mMinAlert: 3.2,
        swarmRateXBaseline: 3.5,
        shallowDepthKmMax: 8,
        escalateIfHansNotNormal: true
      }
    },
    {
      id: "YELLOWSTONE",
      center: [44.43, -110.67],
      radiusKm: 80,
      alertThresholds: {
        mMinAlert: 3.5,
        swarmCount24h: 100,
        swarmRateXBaseline: 4,
        shallowDepthKmMax: 10,
        escalateIfHansNotNormal: true
      }
    },
    {
      id: "NORCAL_OFFSHORE_MENDOCINO_BLANCO",
      bbox: [-130, 38, -123, 44],
      alertThresholds: {
        mMinAlert: 4.5,
        tsunamiCheck: true,
        swarmRateXBaseline: 3
      }
    },
    {
      id: "PNW_CASCADIA_OFFSHORE",
      bbox: [-132.5, 40, -122, 52.5],
      alertThresholds: {
        mMinAlert: 4.5,
        tsunamiCheck: true,
        swarmRateXBaseline: 3
      }
    },
    {
      id: "WESTERN_WA_SEATTLE_WHIDBEY",
      bbox: [-123.5, 46.8, -121.5, 49],
      alertThresholds: {
        mMinAlert: 3.5,
        populationCenterMMin: 3.5,
        swarmRateXBaseline: 3
      }
    },
    {
      id: "CALIFORNIA_FAULTS",
      bbox: [-125, 32, -114, 42.5],
      alertThresholds: {
        mMinAlert: 4.5,
        populationCenterMMin: 3.5,
        swarmRateXBaseline: 3
      }
    },
    {
      id: "CARIBBEAN_VENEZUELA_COMPARATOR",
      bbox: [-75, 8, -58, 20],
      alertThresholds: {
        mMinAlert: 5,
        tsunamiCheck: true,
        swarmRateXBaseline: 3
      }
    }
  ],
  notifier: {
    minStageToNotify: "S3",
    alwaysNotify: [
      "tsunami_warning",
      "tsunami_advisory",
      "usgs_hans_elevated",
      "earthquake_m45_plus_target_region"
    ],
    suppressDuplicateHours: 24
  }
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WatcherConfig {
  return {
    ...DEFAULT_CONFIG,
    dryRun: env.DRY_RUN !== "false",
    pollIntervalMinutes: Number(env.POLL_INTERVAL_MINUTES ?? DEFAULT_CONFIG.pollIntervalMinutes),
    nasaApiKey: env.NASA_API_KEY,
    notifyWebhookUrl: env.NOTIFY_WEBHOOK_URL,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackChannelId: env.SLACK_CHANNEL_ID,
    freshness: {
      ...DEFAULT_CONFIG.freshness,
      maxEventAgeHours: Number(env.MAX_EVENT_AGE_HOURS ?? DEFAULT_CONFIG.freshness.maxEventAgeHours)
    },
    spaceWeather: {
      ...DEFAULT_CONFIG.spaceWeather,
      watchWindowHours: [Number(env.SPACE_WEATHER_WINDOW_HOURS ?? 72)]
    }
  };
}
