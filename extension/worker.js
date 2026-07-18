import { generateSchedules } from './lib/engine.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ schedules: generateSchedules(data.groups, data.options) });
  } catch {
    self.postMessage({ error: 'آماده‌کردن برنامه‌ها با مشکل روبه‌رو شد. دوباره تلاش کنید.' });
  }
};
