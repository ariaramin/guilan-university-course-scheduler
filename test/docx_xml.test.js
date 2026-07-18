import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';

import { DocxParseError, parseWordDocumentXml, readZipEntry } from '../extension/lib/docx-xml.js';
import { parseChartFile, parseChartMatrix } from '../extension/lib/chart-parser.js';

const fixture = new URL('./fixtures/electronics-curriculum.docx', import.meta.url);

function fileFrom(bytes, overrides = {}) {
  return {
    name: 'chart.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    ...overrides,
  };
}

test('reconstructs horizontal, vertical, multiline, nested, and hidden Word content', () => {
  const { matrices, paragraphs, diagnostics } = parseWordDocumentXml(`<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>متن مخفی</w:t></w:r></w:p>
      <w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
        <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>گروه</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>نام</w:t></w:r></w:p><w:p><w:r><w:t>چندخطی</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>درس</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>پنهان</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>تو در تو</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>
      </w:tbl>
    </w:body></w:document>`, DOMParser);

  assert.deepEqual(matrices[0], [['گروه', 'نام\nچندخطی'], ['گروه', 'درس']]);
  assert.deepEqual(matrices[1], [['تو در تو']]);
  assert.deepEqual(paragraphs, []);
  assert.deepEqual({ tables: diagnostics.tablesFound, vertical: diagnostics.verticalMerges }, { tables: 2, vertical: 2 });
});

test('reports corrupted DOCX archives with a stable error code', async () => {
  const bytes = await readFile(fixture);
  const truncated = bytes.subarray(0, bytes.length - 12);
  await assert.rejects(parseChartFile(fileFrom(truncated), { DOMParser, DecompressionStream }), (error) =>
    error instanceof DocxParseError && error.code === 'CORRUPTED_ARCHIVE');
});

test('rejects a misleading DOCX MIME type before parsing content', async () => {
  const bytes = await readFile(fixture);
  await assert.rejects(parseChartFile(fileFrom(bytes, { type: 'application/pdf' }), { DOMParser, DecompressionStream }), (error) =>
    error instanceof DocxParseError && error.code === 'INVALID_FILE');
});

test('identifies password-protected OOXML containers', async () => {
  const bytes = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(parseChartFile(fileFrom(bytes), { DOMParser, DecompressionStream }), (error) =>
    error instanceof DocxParseError && error.code === 'ENCRYPTED_DOCUMENT');
});

test('reports missing and encrypted document entries before XML parsing', async () => {
  await assert.rejects(readZipEntry(new Uint8Array(), null), (error) => error.code === 'MISSING_DOCUMENT_XML');
  await assert.rejects(readZipEntry(new Uint8Array(), { flags: 1 }), (error) => error.code === 'ENCRYPTED_DOCUMENT');
});

test('rejects malformed Word XML instead of recovering ambiguous content', () => {
  assert.throws(() => parseWordDocumentXml('<w:document xmlns:w="urn:test"><w:body><w:p>', DOMParser), (error) =>
    error instanceof DocxParseError && error.code === 'PARSING_FAILED');
});

test('does not parse the same reselected file twice in one dashboard session', async () => {
  const bytes = await readFile(fixture);
  const previousParser = globalThis.DOMParser;
  let reads = 0;
  const selectedFile = () => fileFrom(bytes, {
    name: 'cached-chart.docx', lastModified: 123,
    async arrayBuffer() { reads += 1; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  });
  globalThis.DOMParser = DOMParser;
  try {
    const first = await parseChartFile(selectedFile());
    const second = await parseChartFile(selectedFile());
    assert.equal(reads, 1);
    assert.notStrictEqual(first, second);
    assert.deepEqual(first.map((item) => item.name), second.map((item) => item.name));
  } finally {
    globalThis.DOMParser = previousParser;
  }
});

test('keeps a 2000-row Word table within the parser budget', () => {
  const cells = (values) => `<w:tr>${values.map((value) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  const rows = Array.from({ length: 2000 }, (_, index) => cells([String(100000 + index), `درس ${index}`, '۳'])).join('');
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${cells(['کد درس', 'نام درس', 'تعداد واحد'])}${rows}</w:tbl></w:body></w:document>`;
  const started = performance.now();
  const { matrices } = parseWordDocumentXml(xml, DOMParser);
  const items = parseChartMatrix(matrices[0]);

  assert.equal(items.length, 2000);
  assert.ok(performance.now() - started < 3000);
});
