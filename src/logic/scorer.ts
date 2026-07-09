import type { CascadeState, WatchWindow } from "../types.js";

export function scoreWatchWindow(
  window: WatchWindow,
  states: CascadeState[],
  staleGatePassed: boolean
): WatchWindow["score"] {
  if (!staleGatePassed) {
    return "stale-invalid";
  }

  const inWindow = states.filter(
    (state) =>
      state.stageStartedAt >= window.startedAt &&
      state.stageStartedAt <= window.endsAt &&
      state.activeWindowId === window.id
  );

  if (inWindow.some((state) => state.stage === "S4" || state.stage === "S5")) {
    return "hit";
  }

  if (inWindow.some((state) => state.stage === "S2" || state.stage === "S3")) {
    return "noisy";
  }

  return "miss";
}
