import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';

import { parseChartFile, parseChartMatrix, reconcileChart, similarity, sniffChartType, tableMatricesFromDocument, textMatrixFromDocument } from '../extension/lib/chart-parser.js';

const offered = (id, title, code = id) => ({
  id: `${id}-1`, courseId: code, title, units: 0, unitsKnown: false,
  sessions: [], exam: null, available: true,
});

test('extracts Persian headers, digits, metadata, and merged two-row headers', () => {
  const items = parseChartMatrix([
    ['مشخصات درس', 'مشخصات درس', 'پیشنهاد'],
    ['نام درس', 'تعداد واحد', 'ترم پیشنهادی'],
    ['ریاضی یک', '۳', '۱'],
    ['فیزیک ۲', '٢٫۵', '۲'],
  ]);
  assert.deepEqual(items.map(({ name, units, term }) => ({ name, units, term })), [
    { name: 'ریاضی یک', units: 3, term: '1' },
    { name: 'فیزیک 2', units: 2.5, term: '2' },
  ]);
});

test('extracts every side-by-side course schema after repeated reordered headers', () => {
  const items = parseChartMatrix([
    ['ترم اول', '', '', '', 'ترم دوم', '', '', ''],
    ['کد درس', 'عنوان درس', 'واحد', 'پیش نیاز', 'کد درس', 'عنوان درس', 'واحد', 'پیش نیاز'],
    ['101', 'ریاضی ۱', '۳', '-', '201', 'فیزیک ۲', '۳', 'فیزیک ۱'],
    ['ترم سوم', '', '', '', 'ترم چهارم', '', '', ''],
    ['نام درس', 'کد درس', 'تعداد واحد', 'هم نیاز', 'نام درس', 'کد درس', 'تعداد واحد', 'هم نیاز'],
    ['مدار منطقی', '301', '۳', '-', 'سیستم عامل', '401', '۳', '-'],
  ]);

  assert.deepEqual(items.map(({ name, code, units, term }) => ({ name, code, units, term })), [
    { name: 'ریاضی 1', code: '101', units: 3, term: 'ترم اول' },
    { name: 'فیزیک 2', code: '201', units: 3, term: 'ترم دوم' },
    { name: 'مدار منطقی', code: '301', units: 3, term: 'ترم سوم' },
    { name: 'سیستم عامل', code: '401', units: 3, term: 'ترم چهارم' },
  ]);
});

test('does not mistake a term prerequisite for a semester heading when course code is absent', () => {
  const [item] = parseChartMatrix([
    ['نام درس', 'تعداد واحد', 'پیش نیاز'],
    ['اقتصاد مهندسی', '۳', 'ترم ۴'],
  ]);

  assert.deepEqual({ name: item.name, units: item.units, prerequisite: item.prerequisite }, {
    name: 'اقتصاد مهندسی', units: 3, prerequisite: 'ترم 4',
  });
});

test('reads the provided curriculum directly from DOCX XML without the HTML converter', async () => {
  const bytes = await readFile(new URL('./fixtures/electronics-curriculum.docx', import.meta.url));
  const file = {
    name: 'برنامه کارشناسی الکترونیک2 .docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };

  const items = await parseChartFile(file, { DOMParser, DecompressionStream });
  assert.equal(items.length, 93);
  const math = items.find((item) => item.name === 'ریاضی 1');
  assert.deepEqual({ code: math.code, units: math.units, term: math.term }, {
    code: '12151007', units: 3, term: 'ترم اول(18 واحد)',
  });
  assert.ok(items.some((item) => item.name === 'آز سیستمهای دیجیتال 1' && item.code === '12101128' && item.status === 'needs_review'));
  const reusedCode = items.filter((item) => item.code === '12101128');
  assert.equal(new Set(reusedCode.map((item) => item.id)).size, reusedCode.length);
  assert.ok(items.some((item) => item.name === 'یادگیری ماشین' && item.units === 3));
  assert.ok(items.some((item) => item.name === 'آشنائی با مهندسی برق' && item.units === 1));
  assert.ok(items.some((item) => item.name === 'اقتصاد مهندسی' && item.term === 'ترم چهارم (19 واحد)'));
  const byTerm = Object.fromEntries(Object.entries(Object.groupBy(items.filter((item) => item.term), (item) => item.term))
    .map(([term, records]) => [term, [records.length, records.reduce((sum, item) => sum + item.units, 0)]]));
  assert.deepEqual(byTerm, {
    'ترم اول(18 واحد)': [9, 18], 'ترم دوم(18 واحد)': [7, 18],
    'ترم سوم (19 واحد)': [9, 19], 'ترم چهارم (19 واحد)': [9, 19],
    'ترم پنجم (18 واحد)': [8, 18], 'ترم ششم (2+16 واحد)': [7, 15],
    'ترم هفتم (17 واحد)': [6, 11], 'ترم هشتم (13 واحد)': [2, 4],
  });
  assert.deepEqual({
    tables: items.diagnostics.tablesFound,
    rows: items.diagnostics.rowsFound,
    schemas: items.diagnostics.schemasDetected,
    rejected: items.diagnostics.rejectedRows.length,
  }, { tables: 4, rows: 73, schemas: 12, rejected: 15 });
});

test('rejects section placeholders while calculating theoretical and practical units', () => {
  const items = parseChartMatrix([
    ['نام درس', 'واحد نظری', 'واحد عملی'],
    ['مدار منطقی', '۲', '۱'],
    ['یک درس از جدول اختیاری', '۳', '۰'],
    ['جمع', '۵', '۱'],
  ]);

  assert.deepEqual(items.map(({ name, units }) => ({ name, units })), [{ name: 'مدار منطقی', units: 3 }]);
});

test('flags conflicting duplicate units for human review', () => {
  const [item] = parseChartMatrix([
    ['نام درس', 'تعداد واحد'], ['ریاضی ۱', 3], ['ریاضی یک', 2],
  ]);
  assert.equal(item.status, 'needs_review');
  assert.deepEqual(item.candidateUnits, [3, 2]);
});

test('deduplicates the same course repeated in another table while preserving its code', () => {
  const items = parseChartMatrix([
    ['کد درس', 'نام درس', 'تعداد واحد'],
    ['12101147', 'مدارهای مخابراتی', '۳'],
    ['', 'مدار های مخابراتی', '۳'],
  ]);

  assert.deepEqual(items.map(({ name, code, units }) => ({ name, code, units })), [
    { name: 'مدارهای مخابراتی', code: '12101147', units: 3 },
  ]);
});

test('keeps chart rows with missing units for explicit human review', () => {
  const [item] = parseChartMatrix([
    ['نام درس', 'تعداد واحد'], ['مدار منطقی', ''],
  ]);
  assert.equal(item.status, 'needs_review');
  assert.equal(item.units, null);
  assert.match(item.note, /تعداد واحد/);
});

test('matches by code, normalized name, and high-confidence fuzzy without auto-applying probable units', () => {
  const groups = [offered('a', 'ریاضی ۱', '101'), offered('b', 'برنامه نویسی پیشرفته', '102')];
  const chart = parseChartMatrix([
    ['نام درس', 'تعداد واحد', 'کد درس'],
    ['عنوان متفاوت', 3, '101'],
    ['برنامه نویسی پیشرفت', 3, ''],
  ]);
  const result = reconcileChart(groups, chart);
  assert.equal(result.groups[0].chartStatus, 'matched');
  assert.equal(result.groups[0].unitMatch.strategy, 'exact');
  assert.equal(result.groups[0].units, 3);
  assert.equal(result.groups[1].chartStatus, 'probable_match');
  assert.equal(result.groups[1].unitMatch.strategy, 'fuzzy');
  assert.equal(result.groups[1].unitsKnown, false);
});

test('matches normalized gender labels and safe course aliases but leaves ambiguous fuzzy matches unresolved', () => {
  const groups = [
    offered('a', '(فقط مرد) دانش خانواده و جمعیت گروه ۱'),
    offered('b', 'آزمایشگاه سیستم های دیجیتال ۱'),
    offered('c', 'مدار الکتریکی پیشرفته'),
  ];
  const chart = parseChartMatrix([
    ['نام درس', 'تعداد واحد'],
    ['دانش خانواده و جمعیت', 2],
    ['آز سیستمهای دیجیتال 1', 1],
    ['مدار الکتریکی پیشرفته الف', 3],
    ['مدار الکتریکی پیشرفته ب', 3],
  ]);
  const result = reconcileChart(groups, chart);
  assert.deepEqual(result.groups.slice(0, 2).map((group) => [group.units, group.unitMatch.strategy]), [
    [2, 'normalized'], [1, 'alias'],
  ]);
  assert.equal(result.groups[2].unitsKnown, false);
  assert.equal(result.groups[2].unitMatch.strategy, 'unresolved');
});

test('detects content signatures instead of trusting extensions', () => {
  assert.equal(sniffChartType(Uint8Array.from([0x50, 0x4b, 3, 4]), 'chart.docx'), 'docx');
  assert.throws(() => sniffChartType(new TextEncoder().encode('%PDF-1.7'), 'fake.docx'), /DOCX یا DOC/);
  assert.ok(similarity('ریاضی 1', 'ریاضی 1') > similarity('ریاضی 1', 'فیزیک 2'));
});

test('extracts merged Word tables and explicit course-unit text without guessing', async () => {
  const html = `<html><body>
    <table><tr><th colspan="2">مشخصات درس</th></tr><tr><th>نام درس</th><th>تعداد واحد</th></tr><tr><td rowspan="2">شبکه</td><td>3</td></tr><tr><td>3</td></tr></table>
    <table><tr><th>نام درس</th><th>تعداد واحد</th></tr><tr><td>هوش مصنوعی</td><td>3</td></tr></table>
    <p>سیستم عامل</p><p>۳ واحد</p><p>این متن مبهم ۲ است و نباید پذیرفته شود</p>
  </body></html>`;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const matrices = tableMatricesFromDocument(document);
  assert.equal(matrices.length, 2);
  assert.equal(matrices[0][3][0], 'شبکه');
  assert.deepEqual(textMatrixFromDocument(document), [['نام درس', 'تعداد واحد'], ['سیستم عامل', '3']]);

  const previous = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const bytes = Uint8Array.from([0x50, 0x4b, 3, 4]);
    const file = { name: 'chart.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
    const items = await parseChartFile(file, { convertToHtml: async () => ({ value: html }) });
    assert.deepEqual(items.map(({ name }) => name), ['شبکه', 'هوش مصنوعی', 'سیستم عامل']);
  } finally {
    globalThis.DOMParser = previous;
  }
});

test('explains the safe conversion path for legacy DOC files', async () => {
  const bytes = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]);
  const file = { name: 'chart.doc', type: 'application/msword', size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
  await assert.rejects(parseChartFile(file), /DOCX/);
});

test('rejects non-Word chart files without inventing data', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7');
  const file = { name: 'chart.pdf', type: 'application/pdf', size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
  await assert.rejects(parseChartFile(file), /DOCX یا DOC/);
});
