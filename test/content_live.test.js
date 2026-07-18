import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

test('live content extraction waits through row changes and publishes a later observer update', async () => {
  const observers = [];
  const published = [];
  let messageListener;
  let current = { fingerprint: 'table-a', rowCount: 1, selectorFound: true, tables: [{}] };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const documentListeners = new Map();
  const document = {
    title: 'سامانه سادا',
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    removeEventListener(type, callback) { if (documentListeners.get(type) === callback) documentListeners.delete(type); },
  };
  const context = vm.createContext({
    console, crypto, document, location: { pathname: '/OfferShow.aspx' }, MutationObserver: FakeMutationObserver,
    performance, setTimeout, clearTimeout, addEventListener() {},
    sadaDomExtractor: {
      extractVisibleTables: () => ({ ...current }),
      hasVisibleLoadingIndicator: () => false,
      observationRoots: () => [{}],
    },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListener = listener; } },
        sendMessage: async (message) => { published.push(message); return { ok: true }; },
      },
    },
  });
  vm.runInContext(source, context);

  const response = new Promise((resolve) => {
    assert.equal(messageListener({ type: 'EXTRACT_TABLES', requestId: 'r1' }, {}, resolve), true);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  current = { fingerprint: 'table-b', rowCount: 2, selectorFound: true, tables: [{ rows: [[], [], []] }] };
  observers[0].callback([]);
  const stable = await response;
  assert.equal(stable.readiness, 'stable');
  assert.equal(stable.rowCount, 2);
  assert.equal(stable.fingerprint, 'table-b');

  current = { fingerprint: 'table-c', rowCount: 2, selectorFound: true, tables: [{ rows: [[], [], []] }] };
  observers.at(-1).callback([]);
  await new Promise((resolve) => setTimeout(resolve, 380));
  assert.equal(published.length, 1);
  assert.equal(published[0].type, 'SADA_TABLES_CHANGED');
  assert.equal(published[0].extraction.fingerprint, 'table-c');
});
