export function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end && weeksOverlap(a.week, b.week);
}

function weeksOverlap(a = 'all', b = 'all') {
  return a === 'all' || b === 'all' || a === b;
}

export function examsOverlap(a, b) {
  if (!a || !b || a.date !== b.date || a.start == null || b.start == null) return false;
  return a.start < b.end && b.start < a.end;
}

export function groupsConflict(a, b) {
  return a.sessions.some((left) => b.sessions.some((right) => overlaps(left, right))) ||
    examsOverlap(a.exam, b.exam);
}

function expressionMet(expression, passed, selected) {
  if (!expression) return true;
  if (expression.courseId) return passed.has(expression.courseId) || selected.has(expression.courseId);
  const values = expression.items.map((item) => expressionMet(item, passed, selected));
  return expression.op === 'OR' ? values.some(Boolean) : values.every(Boolean);
}

export function eligibility(group, context) {
  const passed = new Set(context.passedCourseIds);
  const selected = new Set(context.selectedCourseIds ?? []);
  const reasons = [];
  const warnings = [];
  if (passed.has(group.courseId)) reasons.push('درس قبلاً پاس شده است.');
  if (!expressionMet(group.prerequisites, passed, new Set())) reasons.push('پیش‌نیاز کامل نیست.');
  if (!expressionMet(group.corequisites, passed, selected)) reasons.push('هم‌نیاز پاس نشده یا انتخاب نشده است.');
  if (group.available === false) reasons.push('گروه قابل اخذ اعلام نشده است.');
  if (group.unitsKnown === false) reasons.push('تعداد واحد این درس نامشخص است.');
  if (group.exam && group.exam.start == null) warnings.push('ساعت امتحان نامشخص است.');
  warnings.push(...(group.sourceWarnings ?? []));
  return { eligible: reasons.length === 0, reasons, warnings };
}

function scheduleMetrics(groups) {
  const byDay = new Map();
  for (const group of groups) {
    for (const session of group.sessions) {
      byDay.set(session.day, [...(byDay.get(session.day) ?? []), session]);
    }
  }
  let gapMinutes = 0;
  for (const sessions of byDay.values()) {
    sessions.sort((a, b) => a.start - b.start);
    for (let index = 1; index < sessions.length; index += 1) {
      gapMinutes += Math.max(0, sessions[index].start - sessions[index - 1].end);
    }
  }
  return {
    attendanceDays: byDay.size,
    gapMinutes,
    capacityScore: groups.reduce((sum, group) => sum + Math.max(0, group.capacity ?? 0), 0),
  };
}

export function unitRank(schedule, targetUnits) {
  if (schedule.units === targetUnits) return { bucket: 0, distance: 0 };
  if (schedule.units < targetUnits) return { bucket: 1, distance: targetUnits - schedule.units };
  return { bucket: 2, distance: schedule.units - targetUnits };
}

function rankSchedules(a, b, targetUnits) {
  const left = unitRank(a, targetUnits);
  const right = unitRank(b, targetUnits);
  return left.bucket - right.bucket || left.distance - right.distance ||
    b.chartMatchedCount - a.chartMatchedCount ||
    b.preferredCount - a.preferredCount ||
    b.capacityScore - a.capacityScore ||
    a.attendanceDays - b.attendanceDays ||
    a.gapMinutes - b.gapMinutes ||
    b.groups.length - a.groups.length ||
    b.units - a.units;
}

export function generateSchedules(groups, options = {}) {
  const {
    minUnits = 0,
    maxUnits = 30,
    requiredGroupIds = [],
    preferredGroupIds = [],
    passedCourseIds = [],
    limit = 20,
    beamWidth = 1500,
    maxCourses = 10,
    prioritizeChart = true,
  } = options;
  const targetUnits = options.targetUnits ?? options.maxUnits ?? 20;
  const targetCount = options.targetCount ?? null;
  const required = new Set(requiredGroupIds);
  const preferred = new Set(preferredGroupIds);
  const schedulableGroups = groups.filter((group) => group.unitsKnown !== false);
  const byCourse = new Map();
  for (const group of schedulableGroups) {
    byCourse.set(group.courseId, [...(byCourse.get(group.courseId) ?? []), group]);
  }
  const courses = [...byCourse.values()].sort((left, right) => {
    const priority = (items) => items.some((group) => required.has(group.id)) ? 2 : items.some((group) => preferred.has(group.id)) ? 1 : 0;
    return priority(right) - priority(left) ||
      Math.max(...right.map((group) => group.capacity ?? 0)) - Math.max(...left.map((group) => group.capacity ?? 0));
  });
  const conflicts = new Map(schedulableGroups.map((group) => [group.id, new Set()]));
  for (let left = 0; left < schedulableGroups.length; left += 1) {
    for (let right = left + 1; right < schedulableGroups.length; right += 1) {
      if (groupsConflict(schedulableGroups[left], schedulableGroups[right])) {
        conflicts.get(schedulableGroups[left].id).add(schedulableGroups[right].id);
        conflicts.get(schedulableGroups[right].id).add(schedulableGroups[left].id);
      }
    }
  }

  let states = [{
    groups: [], groupIds: [], units: 0,
    preferredCount: 0, chartMatchedCount: 0, capacityScore: 0,
  }];
  for (const courseGroups of courses) {
    const requiredGroups = courseGroups.filter((group) => required.has(group.id));
    if (requiredGroups.length > 1) return [];
    const variants = requiredGroups.length ? requiredGroups : [null, ...courseGroups];
    const next = [];
    for (const state of states) {
      for (const group of variants) {
        if (!group) {
          next.push(state);
          continue;
        }
        const units = state.units + group.units;
        const maxAllowedCourses = targetCount ?? maxCourses;
        if (state.groups.length >= maxAllowedCourses || units > maxUnits || state.groupIds.some((id) => conflicts.get(group.id).has(id))) continue;
        next.push({
          groups: [...state.groups, group],
          groupIds: [...state.groupIds, group.id],
          units,
          preferredCount: state.preferredCount + Number(preferred.has(group.id)),
          chartMatchedCount: state.chartMatchedCount + Number(prioritizeChart && ['matched', 'probable_match'].includes(group.chartStatus)),
          capacityScore: state.capacityScore + Math.max(0, group.capacity ?? 0),
        });
      }
    }
    // ponytail: bounded beam keeps 500-course input responsive; raise beamWidth if measured recall is insufficient.
    const ranked = next.sort((a, b) => rankSchedules(
      { ...a, attendanceDays: 0, gapMinutes: 0 },
      { ...b, attendanceDays: 0, gapMinutes: 0 },
      targetUnits,
    ));
    states = ranked.slice(0, beamWidth);
  }

  const signatures = new Set();
  return states.flatMap((state) => {
    if (!state.groups.length || state.units < minUnits) return [];
    if (targetCount != null && state.groups.length !== targetCount) return [];
    if (![...required].every((id) => state.groupIds.includes(id))) return [];
    const selectedCourseIds = state.groups.map((group) => group.courseId);
    const checks = state.groups.map((group) => eligibility(group, { passedCourseIds, selectedCourseIds }));
    if (checks.some((check) => !check.eligible)) return [];
    const signature = [...state.groupIds].sort().join('|');
    if (signatures.has(signature)) return [];
    signatures.add(signature);
    return [{
      groups: state.groups,
      units: state.units,
      knownUnits: state.units,
      unknownUnitCount: 0,
      unitsComplete: true,
      preferredCount: state.preferredCount,
      chartMatchedCount: state.chartMatchedCount,
      warnings: checks.flatMap((check) => check.warnings),
      ...scheduleMetrics(state.groups),
    }];
  }).sort((a, b) => rankSchedules(a, b, targetUnits)).slice(0, limit);
}
