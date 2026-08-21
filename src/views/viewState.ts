export type Freshness = "LIVE" | "DELAYED" | "STALE" | "OFFLINE";
export type ViewState<T> =
  | { kind: "loading" }
  | { kind: "data"; data: T; at: number; warning?: string }
  | { kind: "error"; message: string };

export type FreshViewState<T> = ViewState<T> & {
  readonly freshness: Freshness;
  freshnessAt(now?: number): Freshness;
};

export const LIVE_WINDOW_MS = 5 * 60_000;
export const DELAYED_WINDOW_MS = 15 * 60_000;

export function computeFreshness(at: number | undefined, now = Date.now()): Freshness {
  if (at === undefined) return "OFFLINE";
  const age = now - at;
  if (age <= LIVE_WINDOW_MS) return "LIVE";
  if (age <= DELAYED_WINDOW_MS) return "DELAYED";
  return "STALE";
}

export function toViewState<T>(state: ViewState<T>, _now = Date.now()): FreshViewState<T> {
  const result = { ...state, freshnessAt: (now = Date.now()) => state.kind === "data" ? computeFreshness(state.at, now) : "OFFLINE" } as FreshViewState<T>;
  Object.defineProperty(result, "freshness", { enumerable: true, get: () => result.freshnessAt() });
  return result;
}

export function retainLastKnownData<T>(state: FreshViewState<T>, error: unknown): FreshViewState<T> {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (state.kind === "data") return toViewState({ kind: "data", data: state.data, at: state.at, warning: message });
  return toViewState({ kind: "error", message });
}
