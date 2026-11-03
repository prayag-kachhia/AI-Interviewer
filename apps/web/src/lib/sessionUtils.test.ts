import { describe, it, expect } from "vitest";
import { isEndedEarly } from "./sessionUtils";

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

  it("returns true when session duration is less than configured limit (15 mins default)", () => {
    const started = "2026-11-01T10:00:00Z";
    const ended = "2026-11-01T10:10:00Z"; // 10 minutes < 15 minutes
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended })).toBe(true);
  });

  it("returns false when session duration is equal to or greater than limit", () => {
    const started = "2026-11-01T10:00:00Z";
    const exact15 = "2026-11-01T10:15:00Z"; // 15 mins
    const past15 = "2026-11-01T10:20:00Z"; // 20 mins
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: exact15 })).toBe(false);
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: past15 })).toBe(false);
  });

  it("supports custom configuredMinutes", () => {
    const started = "2026-11-01T10:00:00Z";
    const ended = "2026-11-01T10:04:00Z"; // 4 mins
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended }, 5)).toBe(true);
    expect(isEndedEarly({ status: "ENDED", startedAt: started, endedAt: ended }, 3)).toBe(false);
  });
});

