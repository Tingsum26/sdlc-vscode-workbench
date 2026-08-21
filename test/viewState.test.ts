import { afterEach, describe, expect, it, vi } from "vitest";
import { computeFreshness, retainLastKnownData, toViewState } from "../src/views/viewState.js";

describe("view state", () => {
  afterEach(() => vi.useRealTimers());
  it("computes freshness from staleness age", () => {
    const now = Date.parse("2026-08-18T12:00:00Z");
    expect(computeFreshness(now - 60_000, now)).toBe("LIVE");
    expect(computeFreshness(now - 6 * 60_000, now)).toBe("DELAYED");
    expect(computeFreshness(now - 16 * 60_000, now)).toBe("STALE");
    expect(computeFreshness(undefined, now)).toBe("OFFLINE");
  });

  it("ages freshness after observation and retains last-known data when refresh fails", () => {
    const observedAt = Date.parse("2026-08-18T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(observedAt);
    const state = toViewState({ kind: "data", data: [{ id: 1 }], at: observedAt }, observedAt);
    expect(state.freshness).toBe("LIVE");
    vi.setSystemTime(observedAt + 6 * 60_000);
    expect(state.freshness).toBe("DELAYED");
    expect(state.freshnessAt(observedAt + 6 * 60_000)).toBe("DELAYED");
    expect(state.freshnessAt(observedAt + 16 * 60_000)).toBe("STALE");

    const retained = retainLastKnownData(state, new Error("service offline"));
    expect(retained).toMatchObject({ kind: "data", data: [{ id: 1 }], warning: "service offline" });
    expect(retained.freshnessAt(observedAt + 16 * 60_000)).toBe("STALE");
  });

  it("builds a loading, data, and error state", () => {
    const loading = toViewState<{ n: number }>({ kind: "loading" });
    expect(loading).toMatchObject({ kind: "loading", freshness: "OFFLINE" });
    const data = toViewState<{ n: number }>({ kind: "data", data: { n: 1 }, at: Date.now() - 60_000 });
    expect(data).toMatchObject({ kind: "data" });
    expect(data.freshness).toBe("LIVE");
    const error = toViewState<{ n: number }>({ kind: "error", message: "boom" });
    expect(error).toMatchObject({ kind: "error", freshness: "OFFLINE" });
  });
});
