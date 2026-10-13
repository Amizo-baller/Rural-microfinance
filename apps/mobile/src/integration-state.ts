export type ApiPage<T> = { items: T[]; total: number; page: number; limit: number };
export function assertPage<T>(page: ApiPage<T>): ApiPage<T> {
  if (
    !page ||
    !Array.isArray(page.items) ||
    !Number.isInteger(page.page) ||
    page.page < 1 ||
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    !Number.isInteger(page.total) ||
    page.total < 0
  )
    throw new Error('The server returned an invalid page. Refresh and try again.');
  return page;
}
export function mergeRecords<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const records = new Map(existing.map((record) => [record.id, record]));
  incoming.forEach((record) => records.set(record.id, record));
  return Array.from(records.values());
}
export class RequestTracker {
  private active = new Map<string, symbol>();
  start(key: string): symbol {
    const ticket = Symbol(key);
    this.active.set(key, ticket);
    return ticket;
  }
  current(key: string, ticket: symbol): boolean {
    return this.active.get(key) === ticket;
  }
  clear(): void {
    this.active.clear();
  }
}
