import assert from 'node:assert/strict';
import test from 'node:test';

import { IntegerInputHandler } from '../extension/lib/numeric-input.js';

// Define global HTMLElement for Node.js test environment compatibility
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class HTMLElement {};
}

class FakeElement extends globalThis.HTMLElement {
  constructor(initialValue = '') {
    super();
    this.value = initialValue;
    this.attributes = {};
    this.listeners = {};
    this.classList = {
      classes: new Set(),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      contains(cls) { return this.classes.has(cls); }
    };
  }
  
  setAttribute(name, val) {
    this.attributes[name] = val;
  }
  
  addEventListener(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }
  
  trigger(event, data = {}) {
    const list = this.listeners[event] || [];
    const ev = {
      type: event,
      preventDefault: () => { ev.defaultPrevented = true; },
      defaultPrevented: false,
      ...data
    };
    for (const cb of list) {
      cb(ev);
    }
    return ev;
  }
}

class FakeErrorElement extends globalThis.HTMLElement {
  constructor() {
    super();
    this.textContent = '';
    this.hidden = true;
  }
}

test('IntegerInputHandler configures input element attributes', () => {
  const input = new FakeElement('۲۰');
  new IntegerInputHandler(input);
  assert.equal(input.attributes['inputmode'], 'numeric');
  assert.equal(input.attributes['pattern'], '[0-9۰-۹٠-٩]*');
});

test('IntegerInputHandler beforeinput filters out non-digits', () => {
  const input = new FakeElement('۱۰');
  new IntegerInputHandler(input);
  
  // Try sending digit
  const ev1 = input.trigger('beforeinput', { data: '۵' });
  assert.equal(ev1.defaultPrevented, false);
  
  // Try sending letter
  const ev2 = input.trigger('beforeinput', { data: 'a' });
  assert.equal(ev2.defaultPrevented, true);
  
  // Try sending dash
  const ev3 = input.trigger('beforeinput', { data: '-' });
  assert.equal(ev3.defaultPrevented, true);
});

test('IntegerInputHandler paste event normalizes digits', () => {
  const input = new FakeElement('');
  new IntegerInputHandler(input);
  
  // Paste digits mixed with letters
  input.trigger('paste', {
    clipboardData: {
      getData: () => '12abc34'
    }
  });
  
  // Check that only digits were extracted and converted to Persian digits
  assert.equal(input.value, '۱۲۳۴');
});

test('IntegerInputHandler validates required empty field', () => {
  const input = new FakeElement('');
  const errorEl = new FakeErrorElement();
  const handler = new IntegerInputHandler(input, {
    required: true,
    label: 'تعداد واحد',
    errorContainer: errorEl
  });
  
  assert.equal(handler.isValid(), false);
  assert.equal(input.classList.contains('input-error'), true);
  assert.equal(errorEl.hidden, false);
  assert.equal(errorEl.textContent, 'وارد کردن تعداد واحد الزامی است.');
});

test('IntegerInputHandler validates range constraints', () => {
  const input = new FakeElement('25'); // out of range [1, 24]
  const errorEl = new FakeErrorElement();
  const handler = new IntegerInputHandler(input, {
    min: 1,
    max: 24,
    label: 'تعداد واحد',
    errorContainer: errorEl
  });
  
  assert.equal(handler.isValid(), false);
  assert.equal(input.classList.contains('input-error'), true);
  assert.equal(errorEl.hidden, false);
  assert.equal(errorEl.textContent, 'تعداد واحد باید حداکثر ۲۴ باشد.');
  
  // Change input to valid value
  input.value = '۱۵';
  input.trigger('input');
  assert.equal(handler.isValid(), true);
  assert.equal(input.classList.contains('input-error'), false);
  assert.equal(errorEl.hidden, true);
});
