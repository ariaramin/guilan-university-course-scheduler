import { minutes, normalizeSourceText } from './normalize.js';

const fieldAliases = {
  title: ['نام درس', 'عنوان درس', 'درس'],
  instructor: ['استاد', 'نام استاد'],
  schedule: ['برنامه زمانی', 'زمان کلاس', 'برنامه زمانی کلاس', 'برنامه کلاس'],
  exam: ['زمان امتحان', 'تاریخ امتحان', 'مکان امتحان'],
  courseId: ['کد درس'],
  units: ['تعداد واحد', 'واحد'],
  capacity: ['ظرفیت مانده', 'ظرفیت باقیمانده', 'ظرفیت'],
  tuition: ['شهریه'],
  degree: ['مقطع'],
  term: ['ترم'],
  gender: ['جنسیت مجاز', 'جنسیت'],
};

const days = new Map([
  ['شنبه', 0], ['یکشنبه', 1], ['دوشنبه', 2], ['سه شنبه', 3],
  ['چهارشنبه', 4], ['پنجشنبه', 5], ['جمعه', 6],
]);

function normalizedText(value) {
  return normalizeSourceText(value);
}

function columnIndexes(headers) {
  const normalizedHeaders = headers.map(normalizedText);
  return Object.fromEntries(Object.entries(fieldAliases).map(([field, aliases]) => [
    field,
    normalizedHeaders.findIndex((header) => aliases.includes(header)),
  ]));
}

function valueAt(row, index) {
  return index < 0 ? '' : normalizedText(row[index] ?? '');
}

function parseTitle(value) {
  const match = value.match(/^(.*?)\s+گروه\s*(\d+)\s*$/);
  return match ? { title: match[1].trim(), groupNumber: match[2] } : { title: value, groupNumber: null };
}

const genderPunctuation = /[()[\]{}（）［］【】،,:؛;|/\\_+ـ–—-]+/g;
const qualifier = '(?:فقط|ویژه|مختص|مخصوص)';
const maleTarget = '(?:مرد(?:ان)?|آقایان|برادران|پسران)';
const femaleTarget = '(?:زن(?:ان)?|بانوان|خواهران|دختران)';

function genderMatches(value, target) {
  const normalized = normalizedText(value).replace(genderPunctuation, ' ').replace(/\s+/g, ' ').trim();
  const qualified = new RegExp(`(?:^|\\s)(${qualifier}\\s*${target}|${target}\\s*${qualifier})(?=\\s|$)`, 'g');
  const matches = [...normalized.matchAll(qualified)].map((match) => match[1]);
  if (new RegExp(`^${target}$`).test(normalized)) matches.push(normalized);
  return { normalized, matches: [...new Set(matches)] };
}

export function classifyGenderEligibility(...values) {
  const sources = values.map((raw) => {
    const male = genderMatches(raw, maleTarget);
    const female = genderMatches(raw, femaleTarget);
    return {
      raw: String(raw ?? ''), normalized: male.normalized,
      malePhrases: male.matches, femalePhrases: female.matches,
    };
  });
  const detected = [];
  if (sources.some((source) => source.malePhrases.length)) detected.push('male');
  if (sources.some((source) => source.femalePhrases.length)) detected.push('female');
  const explicitAll = sources.some(({ normalized }) => /^(?:همه|عمومی|بدون محدودیت|آقایان و بانوان|بانوان و آقایان)$/.test(normalized));
  const eligibility = detected.length > 1 ? 'ambiguous'
    : detected[0] ?? (explicitAll ? 'all' : 'unspecified');
  return {
    eligibility,
    detected,
    phrases: sources.flatMap((source) => [...source.malePhrases, ...source.femalePhrases]),
    sources,
  };
}

export function parseGenderRestriction(value) {
  const { eligibility } = classifyGenderEligibility(value);
  return eligibility === 'male' || eligibility === 'female' ? eligibility : null;
}

export function genderFilterDecision(eligibility, selection) {
  const normalizedEligibility = eligibility ?? 'unspecified';
  if (!selection) return { included: true, reason: 'no-gender-filter' };
  if (normalizedEligibility === 'ambiguous') return { included: false, reason: 'ambiguous-source' };
  if (normalizedEligibility === 'all' || normalizedEligibility === 'unspecified') {
    return { included: true, reason: normalizedEligibility };
  }
  return {
    included: normalizedEligibility === selection,
    reason: normalizedEligibility === selection ? 'matching-restriction' : 'different-restriction',
  };
}

export function genderEligible(eligibility, selection) {
  return genderFilterDecision(eligibility, selection).included;
}

export function cleanGenderRestrictionLabel(value, classification = classifyGenderEligibility(value)) {
  let cleaned = normalizedText(value).replace(genderPunctuation, ' ');
  for (const phrase of classification.phrases.sort((left, right) => right.length - left.length)) {
    cleaned = cleaned.replaceAll(phrase, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function parseSessions(value) {
  const normalized = normalizedText(value);
  const pattern = /(پنجشنبه|چهارشنبه|سه شنبه|دوشنبه|یکشنبه|شنبه|جمعه)[^\d]*(\d{1,2}:\d{2})\s*(?:-|–|تا)\s*(\d{1,2}:\d{2})/g;
  return [...normalized.matchAll(pattern)].map((match) => {
    const first = minutes(match[2]);
    const second = minutes(match[3]);
    return {
      day: days.get(match[1]),
      start: Math.min(first, second),
      end: Math.max(first, second),
      week: /هفته فرد/.test(match[0]) ? 'odd' : /هفته زوج/.test(match[0]) ? 'even' : 'all',
    };
  });
}

export function parseExam(value) {
  const normalized = normalizedText(value);
  if (!normalized || /ندارد/.test(normalized)) return null;
  const date = normalized.match(/(14\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  const times = [...normalized.matchAll(/\b(\d{1,2}:\d{2})\b/g)].map((match) => minutes(match[1]));
  const location = normalized
    .replace(date?.[0] ?? '', ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/پایان ترم|امتحان|[-–—/*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
  return {
    date: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : null,
    calendar: 'jalali',
    start: times.length >= 2 ? Math.min(...times) : null,
    end: times.length >= 2 ? Math.max(...times) : null,
    location,
  };
}

function parseTuition(value) {
  const normalized = normalizedText(value);
  const amount = Number(normalized.replace(/[^\d.]/g, ''));
  if (!normalized || !Number.isFinite(amount)) return null;
  const currency = /ریال/.test(normalized) ? 'IRR' : /تومان/.test(normalized) ? 'IRT' : null;
  return { amount, currency, label: null };
}

function stableTextId(value) {
  return normalizedText(value).replace(/\s+/g, '-');
}

export function scoreSadaTable(table) {
  const headers = table.rows[0] ?? [];
  const indexes = columnIndexes(headers);
  let score = 0;

  if (indexes.title >= 0) score += 20;
  if (indexes.schedule >= 0) score += 20;
  if (indexes.instructor >= 0) score += 10;
  if (indexes.exam >= 0) score += 10;
  if (indexes.capacity >= 0) score += 10;
  if (indexes.degree >= 0) score += 10;
  if (indexes.term >= 0) score += 10;
  if (indexes.tuition >= 0) score += 10;
  if (indexes.gender >= 0) score += 10;
  if (indexes.courseId >= 0) score += 10;
  if (indexes.units >= 0) score += 10;

  if (indexes.title >= 0 && indexes.schedule >= 0) score += 15;
  if (headers.length >= 5 && headers.length <= 15) score += 5;
  if (table.rows.length > 1) score += 5;

  return score;
}

export function parseSadaTables(tables) {
  let bestTable = null;
  let maxScore = -1;
  for (const table of tables) {
    const score = scoreSadaTable(table);
    if (score > maxScore) {
      maxScore = score;
      bestTable = table;
    }
  }

  if (!bestTable || maxScore < 25) {
    return { groups: [], error: 'جدول دروس ارائه‌شده با سرستون‌های شناخته‌شده پیدا نشد.' };
  }

  const table = bestTable;
  const headers = table.rows[0];
  const indexes = columnIndexes(headers);
  const warnings = [];
  if (indexes.units < 0) warnings.push('ستون تعداد واحد در این جدول دیده نشد؛ مجموع واحدها موقتاً صفر است.');
  if (indexes.courseId < 0) warnings.push('ستون کد درس دیده نشد؛ شناسه پایدار از نام درس ساخته شد.');
  let dataRows = table.rows.slice(1);
  if (!dataRows.some((row) => valueAt(row, indexes.title))) {
    const bodyTable = tables
      .filter((candidate) => candidate !== table)
      .sort((a, b) => Math.abs(a.tableIndex - table.tableIndex) - Math.abs(b.tableIndex - table.tableIndex))
      .find(({ rows }) => rows.some((row) => row.length === headers.length && valueAt(row, indexes.title)));
    dataRows = bodyTable?.rows ?? [];
    if (bodyTable) warnings.push('سرستون و بدنه grid از دو جدول جدا خوانده شدند.');
  }
  const groups = dataRows.flatMap((row, rowIndex) => {
    const rawTitle = indexes.title < 0 ? '' : String(row[indexes.title] ?? '').trim();
    if (!normalizedText(rawTitle)) return [];
    const rawGender = indexes.gender < 0 ? '' : String(row[indexes.gender] ?? '').trim();
    const gender = classifyGenderEligibility(rawGender, rawTitle);
    const { title, groupNumber } = parseTitle(cleanGenderRestrictionLabel(rawTitle, gender));
    const courseId = valueAt(row, indexes.courseId) || stableTextId(title);
    const capacityText = valueAt(row, indexes.capacity);
    const capacity = /^\d+$/.test(capacityText) ? Number(capacityText) : null;
    const unitsText = valueAt(row, indexes.units);
    const units = /^\d+(?:\.\d+)?$/.test(unitsText) ? Number(unitsText) : 0;
    const sessions = parseSessions(valueAt(row, indexes.schedule));
    const examText = valueAt(row, indexes.exam);
    const exam = parseExam(examText);
    const sourceWarnings = [];
    if (!sessions.length) sourceWarnings.push('زمان کلاس قابل استخراج نبود.');
    if (examText && !exam) sourceWarnings.push('زمان امتحان قابل استخراج نبود.');
    if (gender.eligibility === 'ambiguous') sourceWarnings.push('محدودیت جنسیت در منبع مبهم یا متناقض است.');
    return [{
      id: `${courseId}-${groupNumber ?? rowIndex + 1}`,
      courseId,
      title,
      rawTitle,
      groupNumber,
      instructor: valueAt(row, indexes.instructor) || null,
      units,
      unitsKnown: indexes.units >= 0 && unitsText !== '',
      capacity,
      tuition: parseTuition(valueAt(row, indexes.tuition)),
      available: capacity == null || capacity > 0,
      degree: valueAt(row, indexes.degree) || null,
      termId: valueAt(row, indexes.term) || null,
      genderEligibility: gender.eligibility,
      genderRestriction: ['male', 'female'].includes(gender.eligibility) ? gender.eligibility : null,
      genderDiagnostics: {
        rawSources: gender.sources.map((source) => source.raw),
        normalizedSources: gender.sources.map((source) => source.normalized),
        detectedPhrases: gender.phrases,
        finalEligibility: gender.eligibility,
      },
      sessions,
      exam,
      sourceWarnings,
    }];
  });
  return groups.length ? { groups, warnings } : { groups, error: 'ردیف درسی در جدول شناخته‌شده پیدا نشد.' };
}
