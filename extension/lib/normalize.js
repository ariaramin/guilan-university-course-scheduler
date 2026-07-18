const digitMap = Object.fromEntries([...'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'].map((digit, index) => [digit, String(index % 10)]));

export function englishDigits(value) {
  return String(value).replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit]);
}

export function normalizeSourceText(value) {
  return englishDigits(value ?? '')
    .normalize('NFKC')
    .replaceAll('ي', 'ی')
    .replaceAll('ى', 'ی')
    .replaceAll('ك', 'ک')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u200C\u200D]/g, ' ')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function minutes(value) {
  const match = englishDigits(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new TypeError(`Invalid time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`Invalid time: ${value}`);
  return hour * 60 + minute;
}

function normalizedSession(session) {
  const start = typeof session.start === 'number' ? session.start : minutes(session.start);
  const end = typeof session.end === 'number' ? session.end : minutes(session.end);
  if (!Number.isInteger(session.day) || session.day < 0 || session.day > 6 || start >= end) {
    throw new RangeError('Each session needs day 0..6 and start before end.');
  }
  return { ...session, start, end };
}

function validateExpression(expression) {
  if (!expression) return;
  if (typeof expression.courseId === 'string' && expression.courseId) return;
  if (!['AND', 'OR'].includes(expression.op) || !Array.isArray(expression.items) || !expression.items.length) {
    throw new TypeError('Rule expressions need courseId or non-empty AND/OR items.');
  }
  expression.items.forEach(validateExpression);
}

export function normalizeGroup(group) {
  if (!group?.id || !group.courseId || !group.title || !Number.isFinite(group.units)) {
    throw new TypeError('Each group needs id, courseId, title, and numeric units.');
  }
  validateExpression(group.prerequisites);
  validateExpression(group.corequisites);
  const exam = group.exam && group.exam.start != null ? {
    ...group.exam,
    start: typeof group.exam.start === 'number' ? group.exam.start : minutes(group.exam.start),
    end: typeof group.exam.end === 'number' ? group.exam.end : minutes(group.exam.end),
  } : group.exam ?? null;
  if (exam?.start != null && exam.start >= exam.end) throw new RangeError('Exam start must be before end.');
  if (group.genderRestriction != null && !['male', 'female'].includes(group.genderRestriction)) {
    throw new TypeError('Gender restriction must be male, female, or null.');
  }
  const genderEligibility = group.genderEligibility
    ?? (group.genderRestriction === 'male' || group.genderRestriction === 'female' ? group.genderRestriction : 'unspecified');
  if (!['male', 'female', 'all', 'unspecified', 'ambiguous'].includes(genderEligibility)) {
    throw new TypeError('Gender eligibility is not recognized.');
  }
  return {
    ...group,
    genderEligibility,
    genderRestriction: ['male', 'female'].includes(genderEligibility) ? genderEligibility : null,
    sessions: (group.sessions ?? []).map(normalizedSession),
    exam,
  };
}
