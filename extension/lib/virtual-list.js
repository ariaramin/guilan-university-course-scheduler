export function visibleRange({ scrollTop, viewportHeight, itemHeight, itemCount, overscan = 6 }) {
  if (itemCount <= 0 || itemHeight <= 0) return { start: 0, end: 0, offset: 0, totalHeight: 0 };
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const end = Math.min(itemCount, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
  return { start, end, offset: start * itemHeight, totalHeight: itemCount * itemHeight };
}

export function variableVisibleRange({ items, heightFor, scrollTop, viewportHeight, overscan = 6 }) {
  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1) + heightFor(item));
  const firstAfter = (value) => {
    let low = 0; let high = offsets.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (offsets[middle] <= value) low = middle + 1; else high = middle;
    }
    return low;
  };
  const start = Math.max(0, firstAfter(scrollTop) - 1 - overscan);
  const end = Math.min(items.length, firstAfter(scrollTop + viewportHeight) + overscan);
  return { start, end, offset: offsets[start], totalHeight: offsets.at(-1) };
}

export function groupedRows(groups, groupBy, collapsed = new Set()) {
  if (!groupBy) return groups.map((group) => ({ type: 'course', group }));
  const buckets = new Map();
  for (const group of groups) {
    let key;
    if (groupBy === 'day') key = String(group.sessions[0]?.day ?? 'unknown');
    else if (groupBy === 'term') key = group.termId || 'unknown';
    else if (groupBy === 'degree') key = group.degree || 'unknown';
    else key = group.chartStatus || 'not_in_chart';
    buckets.set(key, [...(buckets.get(key) ?? []), group]);
  }
  return [...buckets].flatMap(([key, items]) => [
    { type: 'group', key, count: items.length },
    ...(collapsed.has(`${groupBy}:${key}`) ? [] : items.map((group) => ({ type: 'course', group }))),
  ]);
}
