const root = document.querySelector('#print-root');
const status = document.querySelector('#print-status');

function element(tag, text, className = '') {
  const value = document.createElement(tag);
  if (text != null) value.textContent = text;
  if (className) value.className = className;
  return value;
}

function table(headers, rows) {
  const value = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const header of headers) headRow.append(element('th', header));
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tableRow = document.createElement('tr');
    for (const cell of row) tableRow.append(element('td', cell));
    body.append(tableRow);
  }
  value.append(head, body);
  return value;
}

const key = new URL(location.href).searchParams.get('key');
try {
  if (!key?.startsWith('print-')) throw new TypeError('شناسه چاپ معتبر نیست.');
  const stored = await chrome.storage.session.get(key);
  const model = stored[key];
  await chrome.storage.session.remove(key);
  if (!model?.programs?.length) throw new TypeError('اطلاعات برنامه برای چاپ پیدا نشد.');
  document.title = model.programs.length === 1
    ? `برنامه-پیشنهادی-${model.programs[0].number}-دانشگاه-گیلان`
    : 'برنامه‌های-پیشنهادی-دانشگاه-گیلان';
  for (const program of model.programs) {
    const article = element('article', null, 'program');
    const header = element('header', null, 'print-header');
    const identity = element('div', null, 'print-identity');
    const logo = document.createElement('img');
    logo.src = 'assets/university-of-guilan-logo.jpg';
    logo.alt = 'نشان دانشگاه گیلان';
    logo.width = 1467;
    logo.height = 1750;
    identity.append(element('p', 'دانشگاه گیلان'), element('h1', 'برنامه پیشنهادی انتخاب واحد'));
    header.append(logo, identity, element('strong', `برنامه پیشنهادی ${program.number}`));
    article.append(header, element('p', `تاریخ تولید: ${model.generated} · مجموع واحد: ${program.units}`, 'print-meta'));
    article.append(table(
      ['نام درس', 'نام استاد', 'زمان کلاس', 'زمان و مکان امتحان', 'مقطع', 'ترم', 'ظرفیت باقی‌مانده', 'شهریه'],
      program.courses.map((course) => [course.title, course.instructor, course.sessions, course.exam, course.degree, course.term, course.capacity, course.tuition]),
    ));
    article.append(element('h2', 'برنامه هفتگی'));
    article.append(table(['روز', 'کلاس‌ها'], program.week.map((day) => [day.day, day.entries.join('\n')])));
    article.append(element('p', 'این ابزار مستقل است و وابستگی رسمی به دانشگاه گیلان ندارد.', 'print-notice'));
    root.append(article);
  }
  status.textContent = 'فایل برنامه با موفقیت آماده شد.';
  await Promise.all([
    document.fonts.ready,
    ...[...document.images].map((image) => image.decode().catch(() => undefined)),
  ]);
  window.opener?.postMessage({ kind: 'schedule-print', ok: true }, location.origin);
  setTimeout(() => window.print(), 150);
} catch (error) {
  status.dataset.kind = 'error';
  status.textContent = 'ساخت فایل PDF با مشکل روبه‌رو شد. دوباره تلاش کنید.';
  window.opener?.postMessage({ kind: 'schedule-print', ok: false }, location.origin);
}
