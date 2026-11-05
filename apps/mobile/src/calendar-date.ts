import { isValidDate } from './validation';

export function dateParts(value: string) {
  if (!isValidDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return { year, month: month - 1, day };
}

export function calendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Use calendar components, not toISOString(), so selecting a date never changes
// the day when the phone's time zone is ahead of or behind UTC.
export function todayDate(now = new Date()): string {
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export function calendarDays(year: number, month: number): (string | null)[] {
  const first = calendarDate(year, month, 1);
  if (!isValidDate(first)) return [];
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) =>
    index >= offset && index < offset + days ? calendarDate(year, month, index - offset + 1) : null,
  );
}

export function dateLabel(value: string): string {
  return isValidDate(value)
    ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
}

export function selectableDate(value: string, minDate?: string, maxDate?: string): boolean {
  return isValidDate(value) && (!minDate || value >= minDate) && (!maxDate || value <= maxDate);
}
