import { normalizeSourceText } from './normalize.js';

function stableGroup(group) {
  return {
    courseId: group.courseId,
    title: normalizeSourceText(group.title),
    groupNumber: group.groupNumber ?? null,
    instructor: normalizeSourceText(group.instructor ?? ''),
    units: group.units,
    capacity: group.capacity ?? null,
    tuition: group.tuition ? {
      amount: group.tuition.amount ?? null, currency: group.tuition.currency ?? null,
      label: normalizeSourceText(group.tuition.label ?? ''),
    } : null,
    degree: normalizeSourceText(group.degree ?? ''),
    termId: normalizeSourceText(group.termId ?? ''),
    genderEligibility: group.genderEligibility ?? group.genderRestriction ?? 'unspecified',
    sessions: [...(group.sessions ?? [])]
      .map(({ day, start, end, week }) => ({ day, start, end, week: week ?? 'all' }))
      .sort((left, right) => left.day - right.day || left.start - right.start || left.end - right.end),
    exam: group.exam ? {
      date: group.exam.date ?? null, start: group.exam.start ?? null, end: group.exam.end ?? null,
      location: normalizeSourceText(group.exam.location ?? ''),
    } : null,
  };
}

export function courseDatasetFingerprint(groups) {
  const records = groups.map(stableGroup).map((record) => JSON.stringify(record)).sort();
  const input = `[${records.join(',')}]`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createRequestGate(initialFingerprint = '') {
  let latestRequestId = '';
  let fingerprint = initialFingerprint;
  return {
    begin(requestId) { latestRequestId = requestId; },
    accept(response) {
      if (!response || response.requestId !== latestRequestId || !response.fingerprint || response.fingerprint === fingerprint) return false;
      fingerprint = response.fingerprint;
      return true;
    },
    isLatest(requestId) { return requestId === latestRequestId; },
    fingerprint() { return fingerprint; },
  };
}

export function extractionDiagnostic(extraction) {
  const {
    requestId, rowCount, selectorFound, observerStatus, pagePath, capturedAt, durationMs,
  } = extraction;
  return { requestId, rowCount, selectorFound, observerStatus, pagePath, capturedAt, durationMs };
}
