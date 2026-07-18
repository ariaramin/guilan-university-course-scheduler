(() => {
  if (globalThis.__guilanPlannerContent) return;

  const CONTENT_VERSION = '0.9.2';
  const extractor = globalThis.sadaDomExtractor;
  const STABILITY_MS = 350;
  const EXTRACTION_TIMEOUT_MS = 6500;
  const OBSERVER_DEBOUNCE_MS = 300;
  let liveObserver = null;
  let observerTimer = null;
  let lastPublishedFingerprint = '';
  globalThis.__guilanPlannerContent = { version: CONTENT_VERSION };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_SADA_CONTENT_SCRIPT') {
      sendResponse({
        type: 'PONG_SADA_CONTENT_SCRIPT',
        requestId: message.requestId,
        ready: true,
        version: CONTENT_VERSION,
        pageUrl: location.href,
      });
      return;
    }
    if (message?.type === 'PING_CONTENT_SCRIPT') {
      sendResponse({ requestId: message.requestId, ready: true, version: CONTENT_VERSION });
      return;
    }
    if (!['EXTRACT_CURRENT_COURSES', 'EXTRACT_TABLES'].includes(message?.type)) return;
    void waitForStableExtraction(message.requestId ?? crypto.randomUUID())
      .then((result) => sendResponse(result.readiness === 'stable'
        ? { ...result, success: true }
        : { requestId: message.requestId, success: false, errorCode: result.errorCode ?? 'EXTRACTION_TIMEOUT', ...pageMetadata() }))
      .catch((error) => {
        if (globalThis.__SADA_DEBUG_LIVE__) console.debug('SADA content extraction', { requestId: message.requestId, technicalError: error.message });
        sendResponse({ requestId: message.requestId, success: false, errorCode: 'LIVE_EXTRACTION_FAILED', ...pageMetadata() });
      });
    return true;
  });

  function pageMetadata() {
    return {
      pageTitle: document.title,
      pagePath: location.pathname,
      sourceUrl: `${location.origin}${location.pathname}`,
    };
  }

  function connectLiveObserver() {
    liveObserver?.disconnect();
    liveObserver = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => void publishIfChanged(), OBSERVER_DEBOUNCE_MS);
    });
    for (const root of extractor.observationRoots(document)) {
      liveObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  function currentExtraction(requestId, startedAt) {
    const result = extractor.extractVisibleTables(document);
    return {
      requestId,
      extractedAt: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      observerStatus: liveObserver ? 'connected' : 'initializing',
      loadingVisible: extractor.hasVisibleLoadingIndicator(document),
      ...pageMetadata(),
      ...result,
    };
  }

  async function waitForStableExtraction(requestId) {
    const startedAt = performance.now();
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      let stabilityTimer = null;
      let transientObserver = null;
      
      const handleFrameLoad = (event) => { if (event.target?.tagName === 'IFRAME') evaluate(); };
      
      const finish = (result, readiness, errorCode = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(stabilityTimer);
        transientObserver?.disconnect();
        document.removeEventListener('load', handleFrameLoad, true);
        lastPublishedFingerprint = result.fingerprint;
        connectLiveObserver();
        resolve({ ...result, readiness, errorCode, observerStatus: 'connected' });
      };

      const evaluate = () => {
        if (settled) return;
        const result = currentExtraction(requestId, startedAt);
        const ready = result.selectorFound && result.rowCount > 0 && !result.loadingVisible;
        if (ready) finish(result, 'stable');
      };

      transientObserver = new MutationObserver(() => {
        clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(evaluate, STABILITY_MS);
      });

      for (const root of extractor.observationRoots(document)) {
        transientObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
      }

      timeout = setTimeout(() => {
        if (settled) return;
        const finalResult = currentExtraction(requestId, startedAt);
        let errorCode = 'EXTRACTION_TIMEOUT';
        if (!finalResult.selectorFound) errorCode = 'TABLE_NOT_FOUND';
        else if (finalResult.loadingVisible) errorCode = 'TABLE_NOT_READY';
        else if (finalResult.rowCount === 0) errorCode = 'NO_VALID_ROWS';
        finish(finalResult, 'timeout', errorCode);
      }, EXTRACTION_TIMEOUT_MS);

      document.addEventListener('load', handleFrameLoad, true);
      stabilityTimer = setTimeout(evaluate, STABILITY_MS);
    });
  }

  async function publishIfChanged() {
    const startedAt = performance.now();
    const result = currentExtraction(`observer-${Date.now()}`, startedAt);
    
    if (!result.selectorFound || !result.rowCount || result.loadingVisible || result.fingerprint === lastPublishedFingerprint) {
      connectLiveObserver();
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SADA_TABLES_CHANGED',
        extraction: { ...result, success: true, readiness: 'stable', observerStatus: 'connected' },
      });
      if (response?.ok) lastPublishedFingerprint = result.fingerprint;
      else if (response?.retry) {
        clearTimeout(observerTimer);
        observerTimer = setTimeout(() => void publishIfChanged(), OBSERVER_DEBOUNCE_MS);
      }
    } catch {
      // A later focus/manual refresh re-establishes the worker connection.
    } finally {
      connectLiveObserver();
    }
  }

  addEventListener('pagehide', () => {
    liveObserver?.disconnect();
    clearTimeout(observerTimer);
  });
  document.addEventListener('load', (event) => {
    if (event.target?.tagName !== 'IFRAME') return;
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => void publishIfChanged(), OBSERVER_DEBOUNCE_MS);
  }, true);
})();
