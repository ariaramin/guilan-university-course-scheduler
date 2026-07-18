export const CACHE_SCHEMA_VERSION = 1;

function validTime(value) {
  return Number.isFinite(value) && value > 0;
}

function validSourceUrl(value) {
  try { return new URL(value).origin === 'https://sada.guilan.ac.ir'; } catch { return false; }
}

function validCourses(value) {
  return Array.isArray(value) && value.every((course) => course && typeof course === 'object' && !Array.isArray(course));
}

function legacyTime(value) {
  if (validTime(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function createCachedCourseDataset({ courses, extractedAt, sourceUrl, fingerprint, selectedTerm = null }) {
  if (!validCourses(courses) || !validTime(extractedAt) || !validSourceUrl(sourceUrl) || typeof fingerprint !== 'string' || !fingerprint.trim()
    || (selectedTerm != null && typeof selectedTerm !== 'string')) {
    throw new TypeError('Cached course dataset is incomplete.');
  }
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    courses,
    extractedAt,
    sourceUrl,
    fingerprint,
    courseCount: courses.length,
    selectedTerm,
  };
}

export function readCachedCourseDataset(storage, expected = {}) {
  const dataset = storage.cachedCourseDataset;
  if (dataset) {
    const valid = dataset.schemaVersion === CACHE_SCHEMA_VERSION
      && validCourses(dataset.courses)
      && validTime(dataset.extractedAt)
      && validSourceUrl(dataset.sourceUrl)
      && typeof dataset.fingerprint === 'string' && Boolean(dataset.fingerprint.trim())
      && dataset.courseCount === dataset.courses.length;
    if (!valid) return { status: 'invalid', dataset: null };
    const mismatch = (expected.sourceUrl && expected.sourceUrl !== dataset.sourceUrl)
      || (expected.selectedTerm && expected.selectedTerm !== dataset.selectedTerm)
      || (expected.fingerprint && expected.fingerprint !== dataset.fingerprint);
    return { status: mismatch ? 'provisional' : 'valid', dataset };
  }

  if (!Array.isArray(storage.rawGroups) || !storage.rawGroups.length) return { status: 'empty', dataset: null };
  const rawTimestamp = storage.courseDataMeta?.capturedAt ?? storage.lastImportedAt;
  const extractedAt = legacyTime(rawTimestamp);
  const legacy = {
    schemaVersion: 0,
    courses: storage.rawGroups,
    extractedAt,
    sourceUrl: storage.courseDataMeta?.sourceUrl ?? '',
    fingerprint: storage.courseDataMeta?.fingerprint ?? '',
    courseCount: storage.rawGroups.length,
    selectedTerm: null,
  };
  if (!extractedAt) {
    return { status: rawTimestamp == null ? 'legacy-missing-time' : 'legacy-invalid-time', dataset: legacy };
  }
  return {
    status: 'migrated',
    dataset: createCachedCourseDataset({
      ...legacy,
      sourceUrl: legacy.sourceUrl || 'https://sada.guilan.ac.ir/',
      fingerprint: legacy.fingerprint || `legacy-${extractedAt}`,
    }),
  };
}
