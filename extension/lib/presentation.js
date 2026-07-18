const classDays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const jsDays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

export function persianDigits(value) {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function clock(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return persianDigits(minute ? `${hour}:${String(minute).padStart(2, '0')}` : hour);
}

export function formatSessions(sessions = []) {
  if (!sessions.length) return 'زمان کلاس هنوز اعلام نشده است';
  return sessions.map((session) => {
    const week = session.week === 'odd' ? '، هفته‌های فرد' : session.week === 'even' ? '، هفته‌های زوج' : '';
    return `${classDays[session.day] ?? 'روز نامشخص'}، ساعت ${clock(session.start)} تا ${clock(session.end)}${week}`;
  }).join('\n');
}

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor((jy % 33 + 3) / 4) + jd;
  days += jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186;
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const monthDays = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  while (gm <= 12 && gd > monthDays[gm]) gd -= monthDays[gm++];
  return { gy, gm, gd };
}

function examDay(date) {
  const match = String(date ?? '').match(/^(14\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const { gy, gm, gd } = jalaliToGregorian(Number(match[1]), Number(match[2]), Number(match[3]));
  return jsDays[new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay()];
}

export function formatExam(exam) {
  const location = exam?.location || 'مکان امتحان هنوز اعلام نشده است';
  if (!exam?.date || exam.start == null || exam.end == null) {
    return persianDigits(`${location}\nزمان امتحان هنوز اعلام نشده است`);
  }
  const day = examDay(exam.date);
  const date = persianDigits(exam.date.replaceAll('-', '/'));
  return persianDigits(`${location} — ${day ? `روز ${day}، ` : ''}${date}، ساعت ${clock(exam.start)} تا ${clock(exam.end)}`);
}

export function formatCapacity(value) {
  if (!Number.isInteger(value) || value < 0) return 'وضعیت ظرفیت نامشخص است';
  if (value === 0) return 'ظرفیت تکمیل شده است';
  return `${persianDigits(value.toLocaleString('en-US').replaceAll(',', '٬'))} نفر ظرفیت باقی‌مانده`;
}

export function formatTuition(tuition) {
  if (!tuition || !Number.isFinite(tuition.amount) || !tuition.currency) return 'شهریه اعلام نشده است';
  const currencies = { IRR: 'ریال', IRT: 'تومان' };
  const currency = currencies[tuition.currency] ?? tuition.currency;
  const label = tuition.label ? ` — ${tuition.label}` : '';
  return persianDigits(`${tuition.amount.toLocaleString('en-US').replaceAll(',', '٬')} ${currency}${label}`);
}

export function formatTerm(termId) {
  const rawTerm = String(termId ?? '').trim();
  const match = rawTerm.match(/^(\d{4})(\d)$/);
  if (match) return `ترم ${persianDigits(match[2])} · ${persianDigits(match[1])}`;
  return /\p{L}/u.test(rawTerm)
    ? persianDigits(rawTerm)
    : rawTerm ? `ترم ${persianDigits(rawTerm)}` : 'ترم اعلام نشده است';
}

export function formatDegreeTerm(degree, termId) {
  const degreeText = degree || 'مقطع اعلام نشده است';
  const termText = formatTerm(termId);
  return persianDigits(`${degreeText} — ${termText}`);
}
