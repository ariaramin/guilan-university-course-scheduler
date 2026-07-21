import { formatDuration, formatMinutesToTime } from './presentation.js';

/**
 * Calculates free-time gaps between classes for a given list of sessions on a weekday.
 * @param {Array} sessions - Array of session objects: { day, start, end, week }
 * @returns {Array} Array of gap objects: { start, end, duration }
 */
export function calculateGapsForSessions(sessions) {
  const validSessions = sessions.filter(
    (s) => s.start != null && s.end != null && s.start < s.end
  );
  if (validSessions.length <= 1) return [];

  // Sort by start time
  const sorted = [...validSessions].sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent sessions
  const merged = [];
  for (const session of sorted) {
    if (merged.length === 0) {
      merged.push({ start: session.start, end: session.end });
    } else {
      const last = merged[merged.length - 1];
      if (session.start <= last.end) {
        last.end = Math.max(last.end, session.end);
      } else {
        merged.push({ start: session.start, end: session.end });
      }
    }
  }

  // Calculate gaps
  const gaps = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i].end;
    const gapEnd = merged[i + 1].start;
    const duration = gapEnd - gapStart;
    if (duration > 0) {
      gaps.push({ start: gapStart, end: gapEnd, duration });
    }
  }
  return gaps;
}

/**
 * Formats gaps for display.
 * @param {Array} gaps - Gaps calculated by calculateGapsForSessions
 * @returns {string} Persian formatted string
 */
export function formatGapsForDay(gaps) {
  if (!gaps || gaps.length === 0) return 'بدون فاصله';
  return gaps
    .map((gap) => `${formatMinutesToTime(gap.start)} تا ${formatMinutesToTime(gap.end)} — ${formatDuration(gap.duration)}`)
    .join(' · ');
}
