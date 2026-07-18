(function installDomTableExtractor() {
  function textOf(cell) {
    if (!cell) return '';
    const clone = cell.cloneNode(true);
    const hidden = clone.querySelectorAll('[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"],.hidden,.visually-hidden');
    hidden.forEach((el) => el.remove());
    clone.querySelectorAll('br, p, div, tr').forEach((el) => el.after('\n'));
    return clone.textContent.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  function extractDocument(doc, framePath, result) {
    for (const table of doc.querySelectorAll('table')) {
      if (table.getClientRects().length === 0) continue;
      const rows = [...table.rows].map((row) => [...row.cells].map(textOf));
      if (rows.length) result.tables.push({ tableIndex: result.tables.length, framePath, rows });
    }

    for (const grid of doc.querySelectorAll('[role="grid"], [role="table"]')) {
      if (grid.tagName === 'TABLE' || grid.querySelector?.('table') || grid.getClientRects().length === 0) continue;
      const rows = [...grid.querySelectorAll('[role="row"]')].map((row) =>
        [...row.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map(textOf),
      ).filter((row) => row.length);
      if (rows.length) result.tables.push({ tableIndex: result.tables.length, framePath, rows });
    }

    [...doc.querySelectorAll('iframe')].forEach((frame, index) => {
      if (frame.getClientRects().length === 0) return;
      result.visibleFrames += 1;
      try {
        if (!frame.contentDocument) {
          result.unreadableFrames += 1;
          return;
        }
        extractDocument(frame.contentDocument, `${framePath}.${index}`, result);
      } catch {
        result.unreadableFrames += 1;
      }
    });
  }

  function visible(element) {
    return Boolean(element?.getClientRects?.().length);
  }

  function visiblyRendered(element) {
    if (!visible(element)) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0');
  }

  function visitDocuments(doc, visitor) {
    visitor(doc);
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try {
        if (frame.contentDocument) visitDocuments(frame.contentDocument, visitor);
      } catch {
        // A cross-origin frame cannot contain the same-origin SADA course table.
      }
    }
  }

  function tableFingerprint(tables) {
    const input = tables.map(({ framePath, rows }) => [framePath, rows]).flat(3).join('\u001f');
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `table-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function normalizedHeader(value) {
    return String(value).replaceAll('ي', 'ی').replaceAll('ك', 'ک').replace(/\s+/g, ' ').trim();
  }

  const headerAliases = {
    title: ['نام درس', 'عنوان درس', 'درس'],
    instructor: ['نام استاد', 'استاد'],
    schedule: ['زمان کلاس', 'برنامه زمانی', 'برنامه زمانی کلاس', 'برنامه کلاس'],
    exam: ['زمان امتحان', 'تاریخ امتحان', 'مکان امتحان'],
    capacity: ['ظرفیت', 'ظرفیت باقیمانده', 'ظرفیت مانده'],
    degree: ['مقطع'],
    term: ['ترم'],
    tuition: ['شهریه'],
    gender: ['جنسیت مجاز', 'جنسیت'],
    courseId: ['کد درس'],
    units: ['تعداد واحد', 'واحد'],
  };

  function scoreRows(rows) {
    if (!rows || rows.length === 0) return { score: 0, hasTitle: false, hasSchedule: false };
    const headers = (rows[0] ?? []).map(normalizedHeader);
    let score = 0;
    let hasTitle = false;
    let hasSchedule = false;

    for (const header of headers) {
      if (headerAliases.title.includes(header)) { score += 20; hasTitle = true; }
      else if (headerAliases.schedule.includes(header)) { score += 20; hasSchedule = true; }
      else if (headerAliases.instructor.includes(header)) score += 10;
      else if (headerAliases.exam.includes(header)) score += 10;
      else if (headerAliases.capacity.includes(header)) score += 10;
      else if (headerAliases.degree.includes(header)) score += 10;
      else if (headerAliases.term.includes(header)) score += 10;
      else if (headerAliases.tuition.includes(header)) score += 10;
      else if (headerAliases.gender.includes(header)) score += 10;
      else if (headerAliases.courseId.includes(header)) score += 10;
      else if (headerAliases.units.includes(header)) score += 10;
    }

    if (hasTitle && hasSchedule) score += 15;
    if (headers.length >= 5 && headers.length <= 15) score += 5;
    if (rows.length > 1) score += 5;

    return { score, hasTitle, hasSchedule };
  }

  function courseTableStatus(tables) {
    let bestTable = null;
    let maxScore = -1;

    for (const table of tables) {
      const scoreResult = scoreRows(table.rows);
      if (scoreResult.score > maxScore) {
        maxScore = scoreResult.score;
        bestTable = table;
      }
    }

    if (!bestTable || maxScore < 25) {
      return { selectorFound: false, rowCount: 0, confidence: 0 };
    }

    let rowCount = Math.max(0, bestTable.rows.length - 1);
    if (!rowCount) {
      const width = bestTable.rows[0].length;
      rowCount = tables
        .filter((table) => table !== bestTable && table.framePath === bestTable.framePath)
        .flatMap((table) => table.rows)
        .filter((row) => row.length === width).length;
    }

    return { selectorFound: true, rowCount, confidence: maxScore };
  }

  globalThis.sadaDomExtractor = {
    extractVisibleTables(doc) {
      const result = { tables: [], visibleFrames: 0, unreadableFrames: 0 };
      extractDocument(doc, 'top', result);
      const courseStatus = courseTableStatus(result.tables);
      return {
        ...result,
        totalRowCount: result.tables.reduce((count, table) => count + Math.max(0, table.rows.length - 1), 0),
        ...courseStatus,
        fingerprint: tableFingerprint(result.tables),
      };
    },
    hasVisibleLoadingIndicator(doc) {
      let loading = false;
      visitDocuments(doc, (current) => {
        if (loading) return;
        loading = [...current.querySelectorAll('[aria-busy="true"], .loading, .mat-spinner, .mat-progress-spinner')].some(visiblyRendered);
      });
      return loading;
    },
    observationRoots(doc) {
      const roots = new Set();
      visitDocuments(doc, (current) => {
        const tables = [...current.querySelectorAll('table, [role="grid"], [role="table"]')].filter(visible);
        for (const table of tables) {
          roots.add(table.closest?.('form, [role="tabpanel"], .mat-tab-body-content, .table-responsive, .grid-container')
            || table.parentElement || table);
        }
        const frameContainer = current.querySelector?.('#freamContent');
        if (frameContainer) roots.add(frameContainer);
        if (!tables.length && current.body) roots.add(current.body);
      });
      return [...roots];
    },
  };
})();
