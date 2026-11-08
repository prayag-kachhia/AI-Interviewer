import { describe, it, expect } from "vitest";
import { isEndedEarly, EARLY_END_THRESHOLD_MINUTES } from "./sessionUtils";

describe("isEndedEarly", () => {
  it("returns false for null or undefined session", () => {
    expect(isEndedEarly(null)).toBe(false);
    expect(isEndedEarly(undefined)).toBe(false);
  });

  it("respects server-provided endedEarly boolean", () => {
    expect(isEndedEarly({ endedEarly: true })).toBe(true);
    expect(isEndedEarly({ endedEarly: false })).toBe(false);
  });

  it("returns false if session status is not ENDED", () => {
    const started = new Date("2026-11-01T10:00:00Z");
    const ended = new Date("2026-11-01T10:05:00Z"); // 5 mins
    expect(isEndedEarly({ status: "IN_PROGRESS", startedAt: started, endedAt: ended })).toBe(false);
    expect(isEndedEarly({ status: "CREATED", startedAt: started, endedAt: ended })).toBe(false);
  });

  it("returns false if startedAt or endedAt is missing", () => {
    expect(isEndedEarly({ status: "ENDED", startedAt: null, endedAt: "2026-11-01T10:05:00Z" })).toBe(false);
    expect(isEndedEarly({ status: "ENDED", startedAt: "2026-11-01T10:00:00Z", endedAt: null })).toBe(false);
  });

  it("returns false for invalid timestamps", () => {
    expect(isEndedEarly({ status: "ENDED", startedAt: "invalid-date", endedAt: "2026-11-01T10:05:00Z" })).toBe(false);
    expect(isEndedEarly({ status: "ENDED", startedAt: "2026-11-01T10:00:00Z", endedAt: "not-a-date" })).toBe(false);
  });

  it("returns false for reversed or equal timestamps", () => {
    const started = new Date("2026-11-01T10:10:00Z");
    const ended = new Date("2026-11-01T10:05:00Z");
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended })).toBe(false);
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: started })).toBe(false);
  });

  it(`returns true when session duration is less than configured limit (${EARLY_END_THRESHOLD_MINUTES} mins default)`, () => {
    const started = "2026-11-01T10:00:00Z";
    const ended = "2026-11-01T10:10:00Z"; // 10 minutes < EARLY_END_THRESHOLD_MINUTES minutes
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended })).toBe(true);
  });

  it("returns false when session duration is equal to or greater than limit", () => {
    const started = "2026-11-01T10:00:00Z";
    const exactThreshold = new Date(new Date(started).getTime() + EARLY_END_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const pastThreshold = new Date(new Date(started).getTime() + (EARLY_END_THRESHOLD_MINUTES + 5) * 60 * 1000).toISOString();
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: exactThreshold })).toBe(false);
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: pastThreshold })).toBe(false);
  });

  it("supports custom configuredMinutes", () => {
    const started = "2026-11-01T10:00:00Z";
    const ended = "2026-11-01T10:04:00Z"; // 4 mins
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended }, 5)).toBe(true);
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended }, 3)).toBe(false);
  });
});

