import { formatCapacity, formatExam, formatSessions, formatTerm, formatTuition, persianDigits } from './presentation.js';

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
        tuition: formatTuition(group.tuition),
      })),
      week: days.flatMap((day, dayIndex) => {
        const entries = schedule.groups.flatMap((group) => group.sessions
          .filter((session) => session.day === dayIndex)
          .map((session) => `${persianDigits(group.title)} — ${formatSessions([session])}`));
        return entries.length ? [{ day, entries }] : [];
      }),
    })),
  };
}
