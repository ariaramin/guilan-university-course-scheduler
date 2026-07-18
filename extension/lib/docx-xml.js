const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD_NAMESPACES = new Set([WORD_NS, 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const MAX_XML_BYTES = 50 * 1024 * 1024;

const messages = {
  INVALID_FILE: 'فقط فایل Word معتبر با فرمت DOCX قابل خواندن است.',
  CORRUPTED_ARCHIVE: 'این فایل Word قابل خواندن نیست؛ ممکن است خراب یا ناقص باشد.',
  ENCRYPTED_DOCUMENT: 'این فایل Word رمزگذاری شده است. ابتدا رمز آن را در Word بردارید.',
  MISSING_DOCUMENT_XML: 'ساختار اصلی این فایل Word پیدا نشد.',
  EMPTY_DOCUMENT: 'این فایل Word محتوای قابل خواندن ندارد.',
  NO_TABLE_FOUND: 'هیچ جدول درس قابل خواندنی در این سند پیدا نشد.',
  SCHEMA_NOT_DETECTED: 'ستون‌های نام درس و تعداد واحد در جدول‌های سند تشخیص داده نشد.',
  NO_VALID_COURSES: 'هیچ درس قابل‌استفاده‌ای در این فایل Word پیدا نشد.',
  UNSUPPORTED_STRUCTURE: 'ساختار این فایل Word پشتیبانی نمی‌شود؛ لطفاً ردیف‌های علامت‌خورده را بررسی کنید.',
  PARSING_FAILED: 'ساختار داخلی فایل Word قابل تحلیل نیست.',
};

export class DocxParseError extends TypeError {
  constructor(code, detail = '', cause) {
    super(messages[code] ?? messages.PARSING_FAILED, { cause });
    this.name = 'DocxParseError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail, cause) {
  throw new DocxParseError(code, detail, cause);
}

function u16(view, offset) {
  if (offset < 0 || offset + 2 > view.byteLength) fail('CORRUPTED_ARCHIVE', 'Unexpected ZIP boundary');
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) fail('CORRUPTED_ARCHIVE', 'Unexpected ZIP boundary');
  return view.getUint32(offset, true);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateDocxFile(file, bytes, maxBytes) {
  if (!file || !bytes.length) fail('INVALID_FILE', 'Empty file');
  if (!file.name?.toLocaleLowerCase('en').endsWith('.docx')) fail('INVALID_FILE', 'Unexpected extension');
  const allowedMime = new Set(['', 'application/octet-stream', 'application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if (!allowedMime.has((file.type ?? '').toLocaleLowerCase('en'))) fail('INVALID_FILE', 'Unexpected MIME type');
  if (bytes.length > maxBytes) fail('INVALID_FILE', 'File exceeds size limit');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('INVALID_FILE', 'Missing ZIP signature');
}

export function indexZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22, lower = Math.max(0, bytes.length - 65_557); offset >= lower; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) fail('CORRUPTED_ARCHIVE', 'End-of-central-directory record not found');
  if (u16(view, end + 4) || u16(view, end + 6)) fail('CORRUPTED_ARCHIVE', 'Multi-disk ZIP is unsupported');
  const entryCount = u16(view, end + 10);
  const centralSize = u32(view, end + 12);
  const centralOffset = u32(view, end + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) fail('CORRUPTED_ARCHIVE', 'ZIP64 is unnecessary for DOCX files under the size limit');
  if (centralOffset + centralSize > bytes.length) fail('CORRUPTED_ARCHIVE', 'Central directory is outside the archive');
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, offset) !== 0x02014b50) fail('CORRUPTED_ARCHIVE', 'Invalid central-directory entry');
    const flags = u16(view, offset + 8);
    const fileNameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > bytes.length) fail('CORRUPTED_ARCHIVE', 'Invalid ZIP filename boundary');
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd)).replaceAll('\\', '/');
    entries.set(name, {
      name,
      flags,
      method: u16(view, offset + 10),
      crc: u32(view, offset + 16),
      compressedSize: u32(view, offset + 20),
      size: u32(view, offset + 24),
      localOffset: u32(view, offset + 42),
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(bytes, entry, Decompressor = globalThis.DecompressionStream) {
  if (!entry) fail('MISSING_DOCUMENT_XML', 'word/document.xml is absent');
  if (entry.flags & 1) fail('ENCRYPTED_DOCUMENT', 'Encrypted ZIP entry');
  if (entry.size > MAX_XML_BYTES) fail('CORRUPTED_ARCHIVE', 'Expanded XML exceeds safety limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, entry.localOffset) !== 0x04034b50) fail('CORRUPTED_ARCHIVE', 'Invalid local-file header');
  const start = entry.localOffset + 30 + u16(view, entry.localOffset + 26) + u16(view, entry.localOffset + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length) fail('CORRUPTED_ARCHIVE', 'Compressed data is outside the archive');
  const compressed = bytes.subarray(start, end);
  let expanded;
  try {
    if (entry.method === 0) expanded = compressed.slice();
    else if (entry.method === 8 && Decompressor) {
      const stream = new Blob([compressed]).stream().pipeThrough(new Decompressor('deflate-raw'));
      expanded = new Uint8Array(await new Response(stream).arrayBuffer());
    } else fail('CORRUPTED_ARCHIVE', `Unsupported compression method ${entry.method}`);
  } catch (error) {
    if (error instanceof DocxParseError) throw error;
    fail('CORRUPTED_ARCHIVE', 'ZIP decompression failed', error);
  }
  if (expanded.length !== entry.size || crc32(expanded) !== entry.crc) fail('CORRUPTED_ARCHIVE', 'ZIP size or checksum mismatch');
  return new TextDecoder().decode(expanded);
}

function children(node, name) {
  return Array.from(node?.childNodes ?? []).filter((child) => child.nodeType === 1 && (!name || child.localName === name));
}

function descendants(node, name) {
  return Array.from(node?.getElementsByTagNameNS?.('*', name) ?? []);
}

function ancestor(node, name) {
  for (let parent = node?.parentNode; parent; parent = parent.parentNode) if (parent.localName === name) return parent;
  return null;
}

function wordAttribute(node, name) {
  return node?.getAttributeNS?.(WORD_NS, name) || node?.getAttribute?.(`w:${name}`) || node?.getAttribute?.(name) || '';
}

function runIsHidden(run) {
  return descendants(run, 'vanish').length > 0 || ancestor(run, 'del');
}

function paragraphText(paragraph) {
  if (descendants(children(paragraph, 'pPr')[0], 'vanish').length) return '';
  let value = '';
  const visit = (node) => {
    if (node.nodeType === 3) return;
    if (node.localName === 'r' && runIsHidden(node)) return;
    if (node.localName === 'del' || node.localName === 'tbl') return;
    if (node.localName === 't' || node.localName === 'instrText') { value += node.textContent; return; }
    if (node.localName === 'tab') { value += '\t'; return; }
    if (node.localName === 'br' || node.localName === 'cr') { value += '\n'; return; }
    for (const child of children(node)) visit(child);
  };
  visit(paragraph);
  return value;
}

function cellText(cell) {
  return descendants(cell, 'p')
    .filter((paragraph) => ancestor(paragraph, 'tc') === cell && !ancestor(paragraph, 'txbxContent'))
    .map(paragraphText).filter((value) => value.trim()).join('\n');
}

export function reconstructWordTable(table, diagnostics = {}) {
  const rows = descendants(table, 'tr').filter((row) => ancestor(row, 'tbl') === table);
  const matrix = [];
  const vertical = new Map();
  for (const [rowIndex, row] of rows.entries()) {
    const values = [];
    const properties = children(row, 'trPr')[0];
    let column = Number(wordAttribute(descendants(properties, 'gridBefore')[0], 'val')) || 0;
    for (const cell of descendants(row, 'tc').filter((candidate) => ancestor(candidate, 'tr') === row)) {
      while (values[column] != null) column += 1;
      const cellProperties = children(cell, 'tcPr')[0];
      const span = Math.max(1, Number(wordAttribute(descendants(cellProperties, 'gridSpan')[0], 'val')) || 1);
      const merge = descendants(cellProperties, 'vMerge')[0];
      const mergeKind = merge ? wordAttribute(merge, 'val') || 'continue' : null;
      let value = cellText(cell);
      if (mergeKind === 'continue') value = vertical.get(column) ?? value;
      for (let offset = 0; offset < span; offset += 1) {
        values[column + offset] = value;
        if (mergeKind === 'restart') vertical.set(column + offset, value);
        else if (!mergeKind) vertical.delete(column + offset);
      }
      if (span > 1) diagnostics.horizontalMerges = (diagnostics.horizontalMerges ?? 0) + 1;
      if (merge) diagnostics.verticalMerges = (diagnostics.verticalMerges ?? 0) + 1;
      column += span;
    }
    matrix[rowIndex] = values;
  }
  return matrix;
}

export function parseWordDocumentXml(xml, Parser = globalThis.DOMParser) {
  // ponytail: DOMParser is main-thread-only; bundle a SAX worker only if 20 MB documents exceed the UI frame budget.
  if (!Parser) fail('PARSING_FAILED', 'DOMParser is unavailable');
  let document;
  const xmlErrors = [];
  const errorHandler = {
    warning: (message) => xmlErrors.push(message),
    error: (message) => xmlErrors.push(message),
    fatalError: (message) => xmlErrors.push(message),
  };
  try { document = new Parser({ errorHandler }).parseFromString(xml, 'application/xml'); } catch (error) { fail('PARSING_FAILED', 'XML parser rejected document.xml', error); }
  if (xmlErrors.length || !document?.documentElement || descendants(document, 'parsererror').length ||
      document.documentElement.localName !== 'document' || !WORD_NAMESPACES.has(document.documentElement.namespaceURI)) {
    fail('PARSING_FAILED', 'Malformed document.xml');
  }
  const diagnostics = {
    tablesFound: 0, rowsFound: 0, paragraphsFound: 0,
    horizontalMerges: 0, verticalMerges: 0,
    unsupportedElements: {
      textBoxes: descendants(document, 'txbxContent').length,
      drawings: descendants(document, 'drawing').length,
    },
    contentControls: descendants(document, 'sdt').length,
  };
  const tables = descendants(document, 'tbl');
  diagnostics.tablesFound = tables.length;
  const matrices = tables.map((table) => reconstructWordTable(table, diagnostics)).filter((matrix) => matrix.some((row) => row.some((cell) => cell?.trim())));
  diagnostics.rowsFound = matrices.reduce((total, matrix) => total + matrix.length, 0);
  const paragraphs = descendants(document, 'p')
    .filter((paragraph) => !ancestor(paragraph, 'tbl') && !ancestor(paragraph, 'txbxContent'))
    .map(paragraphText).filter((value) => value.trim());
  diagnostics.paragraphsFound = paragraphs.length;
  if (!matrices.length && !paragraphs.length) fail('EMPTY_DOCUMENT', 'No visible paragraphs or tables');
  return { matrices, paragraphs, diagnostics };
}

export async function extractDocxStructure(bytes, environment = {}) {
  const entries = indexZip(bytes);
  if (!entries.has('[Content_Types].xml')) fail('CORRUPTED_ARCHIVE', '[Content_Types].xml is absent');
  const xml = await readZipEntry(bytes, entries.get('word/document.xml'), environment.DecompressionStream);
  const result = parseWordDocumentXml(xml, environment.DOMParser);
  result.diagnostics.archiveEntries = entries.size;
  result.diagnostics.headerParts = [...entries.keys()].filter((name) => /^word\/header\d+\.xml$/i.test(name)).length;
  result.diagnostics.footerParts = [...entries.keys()].filter((name) => /^word\/footer\d+\.xml$/i.test(name)).length;
  return result;
}
