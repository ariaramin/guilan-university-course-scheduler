import assert from 'node:assert/strict';
import test from 'node:test';

import { groupedRows, variableVisibleRange, visibleRange } from '../extension/lib/virtual-list.js';

test('windows 2000 rows without rendering the full collection', () => {
  const range = visibleRange({ scrollTop: 10000, viewportHeight: 600, itemHeight: 56, itemCount: 2000, overscan: 7 });
  assert.equal(range.totalHeight, 112000);
  assert.ok(range.start > 0);
  assert.ok(range.end - range.start < 40);
});

test('flattens collapsible group headers for the virtual viewport', () => {
  const groups = [{ id: 'a', termId: '1' }, { id: 'b', termId: '1' }, { id: 'c', termId: '2' }];
  assert.equal(groupedRows(groups, 'term').length, 5);
  assert.equal(groupedRows(groups, 'term', new Set(['term:1'])).length, 3);
});

test('supports short group headers mixed with taller multiline table rows', () => {
  const items = [{ type: 'group' }, { type: 'course' }, { type: 'course' }];
  const range = variableVisibleRange({ items, heightFor: (item) => item.type === 'group' ? 56 : 176, scrollTop: 60, viewportHeight: 176, overscan: 0 });
  assert.equal(range.totalHeight, 408);
  assert.deepEqual([range.start, range.end, range.offset], [1, 3, 56]);
});
