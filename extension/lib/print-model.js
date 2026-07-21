import { formatCapacity, formatExam, formatSessions, formatSessionTime, formatTerm, persianDigits } from './presentation.js';
import { calculateGapsForSessions, formatGapsForDay } from './free-time.js';

const days = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export function buildPrintModel(schedules, generatedAt = new Date()) {
  const generated = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'long', timeStyle: 'short' }).format(generatedAt);
  return {
    generated,
    programs: schedules.map((schedule, index) => ({
      number: persianDigits(schedule.printNumber ?? index + 1),
      units: `${persianDigits(schedule.units)} واحد`,
      courses: schedule.groups.map((group) => ({
        title: persianDigits(group.title),
        instructor: persianDigits(group.instructor || 'اعلام نشده'),
        sessions: formatSessions(group.sessions),
        exam: formatExam(group.exam),
        degree: persianDigits(group.degree || 'اعلام نشده'),
        term: formatTerm(group.termId),
        capacity: formatCapacity(group.capacity),
      })),
      week: days.flatMap((day, dayIndex) => {
        const entries = schedule.groups.flatMap((group) => group.sessions
          .filter((session) => session.day === dayIndex)
          .map((session) => `${persianDigits(group.title)} — ${formatSessionTime(session)}`));
        
        let gapLine = '';
        if (entries.length) {
          const daySessions = schedule.groups.flatMap((g) => g.sessions.filter((s) => s.day === dayIndex));
          const hasIncomplete = daySessions.some((s) => s.start == null || s.end == null);
          if (hasIncomplete) {
            gapLine = 'محاسبه فاصله برای برخی کلاس‌ها ممکن نبود.';
          } else {
            const gaps = calculateGapsForSessions(daySessions);
            if (gaps.length > 0) {
              gapLine = `فاصله آزاد: ${formatGapsForDay(gaps)}`;
            }
          }
        }
        return entries.length ? [{ day, entries, gapLine }] : [];
      }),
    })),
  };
}
