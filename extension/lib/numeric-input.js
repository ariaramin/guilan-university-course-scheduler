import { englishDigits } from './normalize.js';
import { persianDigits } from './presentation.js';

export class IntegerInputHandler {
  /**
   * Binds validation and strict keystroke/paste filtering to an input element.
   * @param {HTMLInputElement} inputEl 
   * @param {Object} options - { min, max, required, label, errorContainerId, onValidInput }
   */
  constructor(inputEl, options = {}) {
    this.inputEl = inputEl;
    this.options = {
      min: options.min ?? null,
      max: options.max ?? null,
      required: options.required ?? false,
      label: options.label ?? 'فیلد',
      errorContainerId: options.errorContainerId ?? null,
      errorContainer: options.errorContainer ?? null,
      onValidInput: options.onValidInput ?? null,
    };
    this.errorEl = this.options.errorContainer instanceof HTMLElement 
      ? this.options.errorContainer 
      : (this.options.errorContainerId ? document.getElementById(this.options.errorContainerId) : null);
    this.previousValue = inputEl.value;
    
    this.init();
  }

  init() {
    this.inputEl.setAttribute('inputmode', 'numeric');
    this.inputEl.setAttribute('pattern', '[0-9۰-۹٠-٩]*');
    
    // Prevent typing non-digits
    this.inputEl.addEventListener('beforeinput', (e) => this.handleBeforeInput(e));
    this.inputEl.addEventListener('paste', (e) => this.handlePaste(e));
    this.inputEl.addEventListener('drop', (e) => e.preventDefault());
    this.inputEl.addEventListener('input', () => this.handleInput());
  }

  handleBeforeInput(e) {
    if (e.data === null) return;
    // Allow only digits
    if (!/^[0-9۰-۹٠-٩]+$/.test(e.data)) {
      e.preventDefault();
    }
  }

  handlePaste(e) {
    e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
    const sanitized = englishDigits(pastedText).replace(/[^\d]/g, '');
    if (sanitized) {
      const start = this.inputEl.selectionStart;
      const end = this.inputEl.selectionEnd;
      const current = this.inputEl.value;
      const nextValue = current.slice(0, start) + sanitized + current.slice(end);
      this.inputEl.value = persianDigits(nextValue);
      this.handleInput();
    }
  }

  handleInput() {
    const rawVal = englishDigits(this.inputEl.value).trim();
    // Normalize display to Persian digits
    this.inputEl.value = persianDigits(rawVal);
    
    const isValid = this.validate(rawVal);
    if (isValid) {
      this.previousValue = this.inputEl.value;
      if (this.options.onValidInput) {
        this.options.onValidInput(rawVal);
      }
    }
  }

  validate(rawVal) {
    if (rawVal === '') {
      if (this.options.required) {
        this.showError(`وارد کردن ${this.options.label} الزامی است.`);
        return false;
      }
      this.clearError();
      return true;
    }

    const num = Number(rawVal);
    if (!Number.isInteger(num) || num < 0 || String(num) !== rawVal) {
      this.showError('فقط عدد صحیح وارد کنید.');
      return false;
    }

    if (this.options.min !== null && num < this.options.min) {
      this.showError(`${this.options.label} باید حداقل ${persianDigits(this.options.min)} باشد.`);
      return false;
    }

    if (this.options.max !== null && num > this.options.max) {
      this.showError(`${this.options.label} باید حداکثر ${persianDigits(this.options.max)} باشد.`);
      return false;
    }

    this.clearError();
    return true;
  }

  showError(msg) {
    this.inputEl.classList.add('input-error');
    if (this.errorEl) {
      this.errorEl.textContent = msg;
      this.errorEl.hidden = false;
    }
  }

  clearError() {
    this.inputEl.classList.remove('input-error');
    if (this.errorEl) {
      this.errorEl.textContent = '';
      this.errorEl.hidden = true;
    }
  }

  isValid() {
    const rawVal = englishDigits(this.inputEl.value).trim();
    return this.validate(rawVal);
  }
}
