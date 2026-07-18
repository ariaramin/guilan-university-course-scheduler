import { englishDigits, normalizeSourceText } from './normalize.js';
import { cleanGenderRestrictionLabel } from './sada-parser.js';

export function normalizeCourseName(value) {
  return cleanGenderRestrictionLabel(normalizeSourceText(value))
    .replaceAll('ئ', 'ی')
    .replace(/[أإٱ]/g, 'ا')
    .replace(/[ۀة]/g, 'ه')
    .replace(/^(?:نام\s+درس|درس)\s+/g, ' ')
    .replace(/\s+(?:گروه|کلاس|سکشن)\s*\d+\s*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(ها|های)(?=\s|$)/g, '$1')
    .replace(/(^|\s)(یک|دو|سه|چهار)(?=\s|$)/g, (_, before, number) => `${before}${({ یک: 1, دو: 2, سه: 3, چهار: 4 })[number]}`)
    .toLocaleLowerCase('fa');
}

export function normalizeCourseAlias(value) {
  return normalizeCourseName(value)
    .replace(/(?:^|\s)آزمایشگاه(?=\s|$)/g, ' آز ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validUnits(value) {
  const units = Number(englishDigits(value));
  if (!Number.isFinite(units) || units <= 0 || units > 10) {
    throw new TypeError('تعداد واحد هر درس باید عددی مثبت و حداکثر ۱۰ باشد.');
  }
  return units;
}

function entriesFromJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => [
      item.name ?? item.title ?? item['نام درس'],
      item.units ?? item['تعداد واحد'] ?? item['واحد'],
    ]);
  }
  if (value && typeof value === 'object') return Object.entries(value);
  throw new TypeError('ساختار فایل JSON باید آرایه یا نگاشت نام درس به تعداد واحد باشد.');
}

export function delimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function entriesFromCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = ['\t', ';', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = delimitedRows(text, delimiter);
  const headers = (rows.shift() ?? []).map(normalizeCourseName);
  const nameIndex = headers.findIndex((header) => ['نام درس', 'name', 'title'].includes(header));
  const unitIndex = headers.findIndex((header) => ['تعداد واحد', 'واحد', 'units'].includes(header));
  if (nameIndex < 0 || unitIndex < 0) {
    throw new TypeError('فایل CSV باید ستون‌های «نام درس» و «تعداد واحد» داشته باشد.');
  }
  return rows.map((row) => [row[nameIndex], row[unitIndex]]);
}

export function parseCourseUnitFile(text, fileName = '') {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) throw new TypeError('فایل تعداد واحد خالی است.');
  let rawEntries;
  try {
    rawEntries = fileName.toLowerCase().endsWith('.json') || /^[{[]/.test(cleaned)
      ? entriesFromJson(JSON.parse(cleaned))
      : entriesFromCsv(cleaned);
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError('ساختار فایل JSON معتبر نیست. فایل را بررسی کنید.');
    throw error;
  }
  const unitsByName = new Map();
  for (const [name, units] of rawEntries) {
    const normalizedName = normalizeCourseName(name ?? '');
    if (!normalizedName) throw new TypeError('یکی از ردیف‌های فایل نام درس ندارد.');
    const value = validUnits(units);
    if (unitsByName.has(normalizedName) && unitsByName.get(normalizedName) !== value) {
      throw new TypeError(`برای درس «${name}» دو تعداد واحد متفاوت ثبت شده است.`);
    }
    unitsByName.set(normalizedName, value);
  }
  return unitsByName;
}

export function applyCourseUnits(groups, unitsByName) {
  return groups.map((group) => {
    const units = unitsByName.get(normalizeCourseName(group.title));
    const sourceKnown = group.unitsKnown === true && Number(group.units) > 0;
    return {
      ...group,
      units: units ?? (sourceKnown ? group.units : 0),
      unitsKnown: units != null || sourceKnown,
    };
  });
}
