import { normalizeCourseAlias, normalizeCourseName, validUnits } from './course-units.js';
import { DocxParseError, extractDocxStructure, validateDocxFile } from './docx-xml.js';
import { englishDigits } from './normalize.js';

export const MAX_CHART_BYTES = 20 * 1024 * 1024;
const chartCache = new Map();

function text(value) {
  return englishDigits(value ?? '').replaceAll('٫', '.').replaceAll('ي', 'ی').replaceAll('ك', 'ک')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\u00A0‌\s]+/g, ' ').trim();
}

function headerField(value) {
  const normalized = normalizeCourseName(text(value));
  if (!normalized) return null;
  if (/^(ردیف|شماره)$/.test(normalized)) return 'rowNumber';
  if (/(^| )(کد|شماره) درس($| )|^course code$/.test(normalized)) return 'code';
  if (/(نام|عنوان) (درس|دروس)|^درس$|^course name$|^title$/.test(normalized)) return 'name';
  if (/واحد (نظری|تئوری)|^(نظری|تئوری)$|theoretical/.test(normalized)) return 'theoreticalUnits';
  if (/واحد (عملی|آزمایشگاهی)|^(عملی|آزمایشگاهی)$|practical/.test(normalized)) return 'practicalUnits';
  if (/(تعداد|جمع|کل) واحد|^واحد( درس)?$|^units?$|credit/.test(normalized)) return 'units';
  if (/پیش ?نیاز/.test(normalized)) return 'prerequisite';
  if (/هم ?نیاز/.test(normalized)) return 'corequisite';
  if (/ترم|نیم ?سال|semester/.test(normalized)) return 'term';
  if (/مقطع|رشته|گرایش|degree|major/.test(normalized)) return 'degree';
  return null;
}

function headerScore(fields) {
  return Number(fields.includes('name')) * 4 +
    Number(fields.some((field) => ['units', 'theoreticalUnits', 'practicalUnits'].includes(field))) * 4 +
    Number(fields.includes('code')) + Number(fields.includes('term')) + Number(fields.includes('degree'));
}

function combineRows(first = [], second = []) {
  return Array.from({ length: Math.max(first.length, second.length) }, (_, index) => `${text(first[index])} ${text(second[index])}`.trim());
}

function unitOrNull(value) {
  const match = text(value).match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  if (!match) return null;
  try { return validUnits(match[1]); } catch { return null; }
}

function headerSchemas(row) {
  const fields = row.map(headerField);
  if (headerScore(fields) < 8) return [];
  const nameColumns = fields.flatMap((field, index) => field === 'name' && fields[index - 1] !== 'name' ? [index] : []);
  const anchors = fields.flatMap((field, index) => ['code', 'rowNumber'].includes(field) && fields[index - 1] !== field ? [index] : []);
  const anchorsLeadGroups = anchors[0] <= nameColumns[0];
  const starts = nameColumns.map((nameColumn, index) => anchorsLeadGroups
    ? anchors.filter((column) => column > (nameColumns[index - 1] ?? -1) && column <= nameColumn).at(-1) ?? nameColumn
    : nameColumn);
  return nameColumns.map((name, index) => {
    const start = starts[index];
    const end = starts[index + 1] ?? row.length;
    const schema = { start, end, name };
    for (let column = start; column < end; column += 1) {
      const field = fields[column];
      if (field && field !== 'rowNumber' && schema[field] == null) schema[field] = column;
    }
    return schema;
  });
}

function termColumns(row) {
  const points = [];
  for (let column = 0; column < row.length; column += 1) {
    const value = text(row[column]);
    if (/^(?:ترم|نیم ?سال|نیمسال)\s*(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|\d+)/u.test(value) && value !== points.at(-1)?.value) {
      points.push({ column, value });
    }
  }
  if (!points.length) return null;
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const { column, value } = points[index];
    const end = points[index + 1]?.column ?? row.length;
    for (let target = column; target < end; target += 1) result[target] = value;
  }
  return result;
}

function unitsFor(row, schema) {
  const total = schema.units == null ? null : unitOrNull(row[schema.units]);
  if (total != null) return total;
  const theoretical = schema.theoreticalUnits == null ? null : unitOrNull(row[schema.theoreticalUnits]);
  const practical = schema.practicalUnits == null ? null : unitOrNull(row[schema.practicalUnits]);
  const sum = (theoretical ?? 0) + (practical ?? 0);
  return sum > 0 ? sum : null;
}

function isSectionTitle(value) {
  const name = normalizeCourseName(value);
  return /^(جمع|مجموع|تعداد کل|نام درس|عنوان درس)$/.test(name) ||
    /^(1 درس از جدول|دروس? باقیمانده|دروس و آزمایشگاه|دروس آزمایشگاه|دروس آزماشگاه|دروس تحصیلات تکمیلی|حداکثر .* درس از سایر رشته|دروس علوم و معارف)/.test(name);
}

function idFor(item, index) {
  const identity = [item.code, item.name].filter(Boolean).map(normalizeCourseName).join('-').replace(/\s+/g, '-');
  return `chart-${identity || index + 1}`;
}

function deduplicate(items) {
  const byName = new Map();
  const result = [];
  for (const item of items) {
    const name = normalizeCourseName(item.name);
    const code = normalizeCourseName(item.code || '');
    const candidates = byName.get(name) ?? [];
    const previous = candidates.find((candidate) => {
      const candidateCode = normalizeCourseName(candidate.code || '');
      return !code || /^-+$/.test(code) || !candidateCode || /^-+$/.test(candidateCode) || code === candidateCode;
    });
    if (!previous) {
      result.push(item);
      byName.set(name, [...candidates, item]);
    } else if (previous.units !== item.units) {
      previous.status = 'needs_review';
      previous.candidateUnits = [...new Set([...(previous.candidateUnits ?? [previous.units]), item.units])];
      previous.note = 'برای این درس تعداد واحد متفاوت در فایل دیده شد.';
    } else {
      previous.code ||= item.code;
      previous.term ||= item.term;
      previous.degree ||= item.degree;
    }
  }
  const byCode = new Map();
  for (const item of result.filter((entry) => entry.code && !/^[-–—]+$/.test(entry.code))) {
    const code = normalizeCourseName(item.code);
    byCode.set(code, [...(byCode.get(code) ?? []), item]);
  }
  for (const sameCode of byCode.values()) {
    if (new Set(sameCode.map((item) => normalizeCourseName(item.name))).size < 2) continue;
    for (const item of sameCode) {
      item.status = 'needs_review';
      item.note = 'این کد درس برای چند عنوان متفاوت دیده شد؛ لطفاً عنوان و کد را بررسی کنید.';
    }
  }
  return result.map((item, index) => ({ ...item, id: idFor(item, index) }));
}

function heuristicItems(matrix) {
  return matrix.flatMap((row, sourceRow) => {
    const cells = row.map(text).filter(Boolean);
    const units = cells.map(unitOrNull).find((value) => value != null);
    const names = cells.filter((value) => /[\p{L}]/u.test(value) && normalizeCourseName(value).length >= 4 && unitOrNull(value) == null);
    const name = names.sort((a, b) => b.length - a.length)[0];
    return name && units != null ? [{
      name, units, code: null, term: null, degree: null, sourceRow,
      status: 'needs_review', note: 'ساختار ستون‌ها قطعی نبود؛ لطفاً این ردیف را بازبینی کنید.',
    }] : [];
  });
}

export function parseChartMatrix(matrix, source = 'sheet') {
  const rows = matrix.map((row) => Array.isArray(row) ? row : []).filter((row) => row.some((cell) => text(cell)));
  const items = [];
  const diagnostics = { detectedHeaders: [], rejectedRows: [], malformedNumericValues: [] };
  let schemas = [];
  let terms = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const hasCourseRecord = schemas.some((schema) => /[\p{L}]/u.test(text(row[schema.name])) && unitsFor(row, schema) != null);
    const detectedTerms = hasCourseRecord ? null : termColumns(row);
    if (detectedTerms) terms = detectedTerms;
    let detectedSchemas = headerSchemas(row);
    let consumed = 1;
    const combinedSchemas = headerSchemas(combineRows(row, rows[rowIndex + 1]));
    if (combinedSchemas.length > detectedSchemas.length) { detectedSchemas = combinedSchemas; consumed = 2; }
    if (detectedSchemas.length) {
      schemas = detectedSchemas;
      diagnostics.detectedHeaders.push({
        row: rowIndex,
        confidence: Math.min(1, headerScore(combineRows(row, consumed === 2 ? rows[rowIndex + 1] : []).map(headerField)) / 10),
        schemas: schemas.map(({ start, end, ...fields }) => ({ start, end, fields })),
      });
      rowIndex += consumed - 1;
      continue;
    }
    if (detectedTerms) continue;
    for (const schema of schemas) {
      const name = text(row[schema.name]);
      if (!name || !/[\p{L}]/u.test(name)) {
        if (row.slice(schema.start, schema.end).some((cell) => text(cell))) diagnostics.rejectedRows.push({ row: rowIndex, reason: 'missing_course_name' });
        continue;
      }
      if (isSectionTitle(name)) { diagnostics.rejectedRows.push({ row: rowIndex, reason: 'section_or_summary' }); continue; }
      const units = unitsFor(row, schema);
      if (units == null) diagnostics.malformedNumericValues.push({ row: rowIndex, field: 'units' });
      items.push({
        name,
        units,
        code: schema.code == null ? null : text(row[schema.code]) || null,
        term: schema.term == null ? terms[schema.name] ?? null : text(row[schema.term]) || terms[schema.name] || null,
        degree: schema.degree == null ? null : text(row[schema.degree]) || null,
        prerequisite: schema.prerequisite == null ? null : text(row[schema.prerequisite]) || null,
        corequisite: schema.corequisite == null ? null : text(row[schema.corequisite]) || null,
        theoreticalUnits: schema.theoreticalUnits == null ? null : unitOrNull(row[schema.theoreticalUnits]),
        practicalUnits: schema.practicalUnits == null ? null : unitOrNull(row[schema.practicalUnits]),
        sourceRow: rowIndex,
        status: units == null ? 'needs_review' : 'unmatched_chart_item',
        note: units == null ? 'تعداد واحد این درس در فایل پیدا نشد.' : null,
      });
    }
  }
  if (!items.length) items.push(...heuristicItems(rows));
  if (!items.length) throw new TypeError('ستون‌های نام درس و تعداد واحد در فایل چارت پیدا نشد.');
  const result = deduplicate(items.map((item) => ({ ...item, source, status: item.status ?? 'unmatched_chart_item' })));
  diagnostics.parsedRecords = result.length;
  diagnostics.duplicateRecords = items.length - result.length;
  Object.defineProperty(result, 'diagnostics', { value: diagnostics, enumerable: false });
  return result;
}

export function sniffChartType(bytes, fileName = '', mime = '') {
  if (bytes.length > MAX_CHART_BYTES) throw new TypeError('حجم فایل چارت باید حداکثر ۲۰ مگابایت باشد.');
  const extension = fileName.toLowerCase().split('.').pop();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && extension === 'docx') return 'docx';
  const compoundFile = [0xd0, 0xcf, 0x11, 0xe0].every((value, index) => bytes[index] === value);
  if (compoundFile && extension === 'docx') throw new DocxParseError('ENCRYPTED_DOCUMENT', 'OOXML is wrapped in an encrypted compound file');
  if (compoundFile && extension === 'doc') return 'doc';
  throw new TypeError('فقط فایل Word با فرمت DOCX یا DOC قابل انتخاب است.');
}

export function tableMatricesFromDocument(document) {
  return Array.from(document.getElementsByTagName('table')).map((table) => {
    const matrix = [];
    const rows = Array.from(table.getElementsByTagName('tr')).filter((row) => {
      for (let parent = row.parentNode; parent; parent = parent.parentNode) {
        if (parent.nodeName?.toLowerCase() === 'table') return parent === table;
      }
      return false;
    });
    rows.forEach((row, rowIndex) => {
      matrix[rowIndex] ??= [];
      const cells = Array.from(row.childNodes).filter((cell) =>
        ['td', 'th'].includes(cell.nodeName.toLowerCase()) && cell.parentNode === row);
      let column = 0;
      for (const cell of cells) {
        while (matrix[rowIndex][column] != null) column += 1;
        const colSpan = Math.max(1, Number(cell.getAttribute?.('colspan')) || 1);
        const rowSpan = Math.max(1, Number(cell.getAttribute?.('rowspan')) || 1);
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          matrix[rowIndex + rowOffset] ??= [];
          for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
            matrix[rowIndex + rowOffset][column + columnOffset] = text(cell.textContent);
          }
        }
        column += colSpan;
      }
    });
    return matrix;
  }).filter((matrix) => matrix.some((row) => row.some(Boolean)));
}

export function textMatrixFromDocument(document) {
  const insideTable = (element) => {
    for (let parent = element.parentNode; parent; parent = parent.parentNode) {
      if (parent.nodeName?.toLowerCase() === 'table') return true;
    }
    return false;
  };
  const blocks = ['p', 'li'].flatMap((tag) => Array.from(document.getElementsByTagName(tag)))
    .filter((element) => !insideTable(element)).map((element) => text(element.textContent)).filter(Boolean);
  return textMatrixFromBlocks(blocks);
}

export function textMatrixFromBlocks(blocks) {
  const rows = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const line = text(blocks[index]);
    const inline = line.match(/^(.{4,}?[\p{L}].*?)\s+(\d+(?:\.\d+)?)\s*واحد$/u);
    if (inline) { rows.push([inline[1], inline[2]]); continue; }
    const nextUnits = text(blocks[index + 1]).match(/^(?:تعداد واحد\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(?:واحد)?$/u);
    if (/[\p{L}]/u.test(line) && normalizeCourseName(line).length >= 4 && nextUnits) {
      rows.push([line, nextUnits[1]]); index += 1;
    }
  }
  return rows.length ? [['نام درس', 'تعداد واحد'], ...rows] : [];
}

async function parseDocxHtml(bytes, wordProcessor) {
  let html;
  try {
    ({ value: html } = await wordProcessor.convertToHtml({ arrayBuffer: bytes.buffer }));
  } catch {
    throw new TypeError('فایل DOCX قابل خواندن نیست؛ ممکن است خراب یا رمزگذاری شده باشد.');
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  const matrices = tableMatricesFromDocument(document);
  const textMatrix = textMatrixFromDocument(document);
  if (textMatrix.length) matrices.push(textMatrix);
  const items = matrices.flatMap((matrix, index) => {
    try { return parseChartMatrix(matrix, `word:table-${index + 1}`); } catch { return []; }
  });
  if (!items.length) throw new TypeError('در جدول‌ها یا متن فایل Word، نام درس و تعداد واحد قابل‌استفاده‌ای پیدا نشد.');
  return { items: deduplicate(items), diagnostics: { strategy: 'html', tablesFound: matrices.length, parsedRecords: items.length } };
}

async function parseDocx(bytes, environment = {}) {
  if (typeof environment.convertToHtml === 'function') return parseDocxHtml(bytes, environment);
  const structure = await extractDocxStructure(bytes, {
    DOMParser: environment.DOMParser ?? globalThis.DOMParser,
    DecompressionStream: environment.DecompressionStream ?? globalThis.DecompressionStream,
  });
  const matrices = [...structure.matrices];
  const textMatrix = textMatrixFromBlocks(structure.paragraphs);
  if (textMatrix.length) matrices.push(textMatrix);
  const rejectedTables = [];
  const matrixDiagnostics = [];
  const parsed = matrices.flatMap((matrix, index) => {
    try {
      const items = parseChartMatrix(matrix, `word:${index < structure.matrices.length ? `table-${index + 1}` : 'paragraphs'}`);
      matrixDiagnostics.push({ table: index + 1, ...items.diagnostics });
      return items;
    }
    catch (error) { rejectedTables.push({ table: index + 1, reason: error.message }); return []; }
  });
  if (!parsed.length) {
    const fallback = environment.wordProcessor ?? globalThis.mammoth;
    if (fallback?.convertToHtml) {
      try { return await parseDocxHtml(bytes, fallback); } catch { /* Direct parser error below is more useful. */ }
    }
    throw new DocxParseError(structure.matrices.length ? 'SCHEMA_NOT_DETECTED' : 'NO_TABLE_FOUND');
  }
  const items = deduplicate(parsed);
  return {
    items,
    diagnostics: {
      ...structure.diagnostics,
      strategy: 'xml',
      schemasDetected: matrixDiagnostics.reduce((total, entry) => total + entry.detectedHeaders.reduce((sum, header) => sum + header.schemas.length, 0), 0),
      detectedHeaders: matrixDiagnostics.flatMap((entry) => entry.detectedHeaders.map((header) => ({ table: entry.table, ...header }))),
      parsedRecords: items.length,
      recordsNeedingReview: items.filter((item) => item.status === 'needs_review').length,
      duplicateRecords: parsed.length - items.length + matrixDiagnostics.reduce((total, entry) => total + entry.duplicateRecords, 0),
      malformedNumericValues: matrixDiagnostics.reduce((total, entry) => total + entry.malformedNumericValues.length, 0),
      rejectedRows: matrixDiagnostics.flatMap((entry) => entry.rejectedRows.map((row) => ({ table: entry.table, ...row }))),
      rejectedTables,
    },
  };
}

export async function parseChartFileDetailed(file, environment = {}) {
  if (!file || file.size === 0) throw new TypeError('فایل چارت خالی است.');
  if (file.size > MAX_CHART_BYTES) throw new TypeError('حجم فایل چارت باید حداکثر ۲۰ مگابایت باشد.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffChartType(bytes, file.name, file.type);
  if (type === 'doc') throw new TypeError('این فایل با فرمت قدیمی Word ذخیره شده است. برای استخراج دقیق‌تر، آن را به فرمت DOCX تبدیل و دوباره بارگذاری کنید.');
  if (type === 'docx') {
    if (typeof environment.convertToHtml !== 'function') validateDocxFile(file, bytes, MAX_CHART_BYTES);
    return parseDocx(bytes, environment);
  }
  throw new TypeError('فقط فایل Word با فرمت DOCX یا DOC قابل انتخاب است.');
}

export async function parseChartFile(file, environment = {}) {
  const cacheable = !Object.keys(environment).length;
  // ponytail: session-only metadata key; use SHA-256 only if identical name/size/mtime collisions appear in practice.
  const cacheKey = cacheable ? `${file?.name}\u0000${file?.size}\u0000${file?.lastModified ?? 0}` : null;
  let pending = cacheKey && chartCache.get(cacheKey);
  if (!pending) {
    pending = parseChartFileDetailed(file, environment);
    if (cacheKey) {
      chartCache.set(cacheKey, pending);
      if (chartCache.size > 3) chartCache.delete(chartCache.keys().next().value);
      pending.catch(() => chartCache.delete(cacheKey));
    }
  }
  const parsed = await pending;
  const { items, diagnostics } = cacheable ? structuredClone(parsed) : parsed;
  Object.defineProperty(items, 'diagnostics', { value: diagnostics, enumerable: false });
  return items;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1]));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function similarity(left, right) {
  if (!left && !right) return 1;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length, 1);
}

export function reconcileChart(groups, chartItems, manualMatches = {}) {
  const courses = [...new Map(groups.map((group) => [group.courseId, group])).values()];
  const byCode = new Map(courses.map((group) => [normalizeCourseName(group.courseId), group]));
  const byName = new Map();
  const byRawName = new Map();
  const byAlias = new Map();
  for (const group of courses) {
    const name = normalizeCourseName(group.title);
    byName.set(name, [...(byName.get(name) ?? []), group]);
    const rawName = String(group.title).trim();
    byRawName.set(rawName, [...(byRawName.get(rawName) ?? []), group]);
    const alias = normalizeCourseAlias(group.title);
    byAlias.set(alias, [...(byAlias.get(alias) ?? []), group]);
  }
  const matches = new Map();
  const updatedItems = chartItems.map((item) => {
    let match = courses.find((group) => group.courseId === manualMatches[item.id]);
    let status = match ? 'matched' : item.status === 'needs_review' ? 'needs_review' : null;
    let confidence = match ? 1 : 0;
    let strategy = match ? 'alias' : 'unresolved';
    if (!match && status !== 'needs_review') {
      const raw = byRawName.get(String(item.name).trim()) ?? [];
      if (raw.length === 1) { [match] = raw; strategy = 'exact'; }
      else if (raw.length > 1) status = 'needs_review';
    }
    if (!match && status !== 'needs_review' && item.code) {
      match = byCode.get(normalizeCourseName(item.code));
      if (match) strategy = 'exact';
    }
    if (match) { status = 'matched'; confidence = 1; }
    if (!match && status !== 'needs_review') {
      const exact = byName.get(normalizeCourseName(item.name)) ?? [];
      if (exact.length === 1) { [match] = exact; status = 'matched'; confidence = 1; strategy = 'normalized'; }
      else if (exact.length > 1) status = 'needs_review';
    }
    if (!match && status !== 'needs_review') {
      const aliases = byAlias.get(normalizeCourseAlias(item.name)) ?? [];
      if (aliases.length === 1) { [match] = aliases; status = 'matched'; confidence = 1; strategy = 'alias'; }
      else if (aliases.length > 1) status = 'needs_review';
    }
    if (!match && status !== 'needs_review') {
      const scored = courses.map((group) => ({ group, score: similarity(normalizeCourseName(item.name), normalizeCourseName(group.title)) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 0.92 && scored[0].score - (scored[1]?.score ?? 0) >= 0.04) {
        match = scored[0].group; status = 'probable_match'; confidence = scored[0].score; strategy = 'fuzzy';
      }
    }
    if (match && !(Number(item.units) > 0)) status = 'needs_review';
    if (match) matches.set(match.courseId, { item, status, confidence, strategy });
    return { ...item, status: status ?? 'unmatched_chart_item', matchCourseId: match?.courseId ?? null, confidence, matchStrategy: strategy };
  });
  const updatedGroups = groups.map((group) => {
    const match = matches.get(group.courseId);
    const normalizedTitle = normalizeCourseName(group.title);
    if (!match) return {
      ...group,
      chartStatus: 'not_in_chart',
      unitMatch: { courseId: group.courseId, rawTitle: group.rawTitle ?? group.title, normalizedTitle, strategy: 'unresolved', confidence: 0 },
    };
    const confirmed = match.status === 'matched' && Number(match.item.units) > 0;
    return {
      ...group,
      chartStatus: match.status,
      chartItemId: match.item.id,
      chartConfidence: match.confidence,
      unitMatch: {
        courseId: group.courseId,
        rawTitle: group.rawTitle ?? group.title,
        normalizedTitle,
        matchedTitle: match.item.name,
        units: confirmed ? match.item.units : undefined,
        strategy: confirmed ? match.strategy : match.strategy === 'fuzzy' ? 'fuzzy' : 'unresolved',
        confidence: match.confidence,
      },
      units: confirmed ? match.item.units : group.units,
      unitsKnown: confirmed ? true : group.unitsKnown,
      suggestedTerm: match.item.term,
      chartDegree: match.item.degree,
    };
  });
  return { groups: updatedGroups, items: updatedItems };
}
