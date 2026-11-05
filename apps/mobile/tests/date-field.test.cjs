const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => load(name.slice(2)),
  });
  return module.exports;
}
const dates = load('calendar-date');

test('calendar handles leap days, month lengths and Monday-first alignment', () => {
  const february = dates.calendarDays(2024, 1);
  assert.equal(february[0], null);
  assert.equal(february[3], '2024-02-01');
  assert.equal(february.filter(Boolean).length, 29);
  assert.equal(dates.calendarDays(2023, 1).filter(Boolean).length, 28);
  assert.equal(dates.calendarDays(1900, 1).filter(Boolean).length, 28);
  assert.equal(dates.calendarDays(2000, 1).filter(Boolean).length, 29);
  assert.equal(dates.calendarDays(2026, 3).filter(Boolean).length, 30);
  assert.equal(dates.calendarDays(2026, 11).filter(Boolean).length, 31);
  assert.equal(dates.calendarDays(2026, 12).length, 0);
});
test('selected dates stay date-only and limits reject invalid or future contribution dates', () => {
  assert.equal(dates.calendarDate(2024, 1, 29), '2024-02-29');
  assert.equal(dates.dateParts('2023-02-29'), null);
  assert.equal(dates.dateParts('not-a-date'), null);
  assert.equal(dates.dateParts('2024-02-29').day, 29);
  assert.equal(dates.selectableDate('2026-10-19', '2026-10-01', '2026-10-19'), true);
  assert.equal(dates.selectableDate('2026-10-20', undefined, '2026-10-19'), false);
  assert.equal(dates.selectableDate('2026-09-30', '2026-10-01'), false);
  assert.equal(dates.selectableDate('2026-02-30'), false);
  // A phone supplies its local calendar components, not the UTC ISO day.
  assert.equal(
    dates.todayDate({ getFullYear: () => 2026, getMonth: () => 0, getDate: () => 1 }),
    '2026-01-01',
  );
});
