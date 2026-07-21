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
    for (const cell of row) {
      const td = document.createElement('td');
      if (cell instanceof HTMLElement) {
        td.append(cell);
      } else {
        td.textContent = cell;
        td.style.whiteSpace = 'pre-line';
      }
      tableRow.append(td);
    }
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
    ? `برنامه‌ریز-انتخاب-واحد-${model.programs[0].number}`
    : 'برنامه‌ریز-انتخاب-واحد';
  for (const program of model.programs) {
    const article1 = element('article', null, 'program page-1');
    const header = element('header', null, 'print-header');
    const identity = element('div', null, 'print-identity');
    const logo = document.createElement('img');
    logo.src = 'assets/university-of-guilan-logo.jpg';
    logo.alt = 'نشان دانشگاه گیلان';
    logo.width = 1467;
    logo.height = 1750;
    identity.append(element('p', 'دانشگاه گیلان'), element('h1', 'برنامه‌ریز انتخاب واحد'));
    header.append(logo, identity);
    article1.append(header, element('p', `مجموع واحد: ${program.units}`, 'print-meta'));
    article1.append(table(
      ['نام درس', 'نام استاد', 'زمان کلاس', 'زمان و مکان امتحان', 'مقطع', 'ترم', 'ظرفیت باقی‌مانده'],
      program.courses.map((course) => [course.title, course.instructor, course.sessions, course.exam, course.degree, course.term, course.capacity]),
    ));
    root.append(article1);

    const article2 = element('article', null, 'program page-2');
    article2.append(element('h2', 'برنامه هفتگی'));
    article2.append(table(['روز', 'کلاس‌ها'], program.week.map((day) => {
      const cellContent = document.createElement('div');
      cellContent.style.whiteSpace = 'pre-line';
      
      const classesText = document.createElement('div');
      classesText.textContent = day.entries.join('\n');
      cellContent.append(classesText);
      
      if (day.gapLine) {
        const gapText = document.createElement('div');
        gapText.textContent = `(${day.gapLine})`;
        gapText.style.fontSize = '0.75rem';
        gapText.style.color = '#66736E';
        gapText.style.marginTop = '4px';
        cellContent.append(gapText);
      }
      return [day.day, cellContent];
    })));
    root.append(article2);
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
