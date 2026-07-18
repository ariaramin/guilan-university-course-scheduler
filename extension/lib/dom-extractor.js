(function installDomTableExtractor() {
  function textOf(cell) {
    return cell.textContent.replace(/\s+/g, ' ').trim();
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

  function courseTableStatus(tables) {
    const headerTable = tables.find(({ rows }) => {
      const headers = (rows[0] ?? []).map(normalizedHeader);
      return headers.includes('نام درس') && headers.includes('برنامه زمانی');
    });
    if (!headerTable) return { selectorFound: false, rowCount: 0 };
    let rowCount = Math.max(0, headerTable.rows.length - 1);
    if (!rowCount) {
      const width = headerTable.rows[0].length;
      rowCount = tables
        .filter((table) => table !== headerTable && table.framePath === headerTable.framePath)
        .flatMap((table) => table.rows)
        .filter((row) => row.length === width).length;
    }
    return { selectorFound: true, rowCount };
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
