export interface SessionTimingInfo {
  status?: string | null;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  endedEarly?: boolean | null;
}

/**
 * Determines whether an interview ended before its configured time limit.
 *
 * Defaults to 15 minutes (900 seconds). Handles missing, invalid, or reversed timestamps safely.
 */
export function isEndedEarly(session?: SessionTimingInfo | null, configuredMinutes = 15): boolean {
  if (!session) return false;

  // If the server explicitly calculated endedEarly, respect it
  if (typeof session.endedEarly === "boolean") {
    return session.endedEarly;
  }

  // Only ENDED sessions can be marked as ended early
  if (session.status !== "ENDED") {
    return false;
  }

  if (!session.startedAt || !session.endedAt) {
    return false;
  }

  const started = new Date(session.startedAt).getTime();
  const ended = new Date(session.endedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return false;
  }

  // Reversed timestamps or zero/negative duration is invalid
  if (ended <= started) {
    return false;
  }

  const durationSec = (ended - started) / 1000;
  const configuredSec = configuredMinutes * 60;

  return durationSec < configuredSec;
}

