// Admin replaces the old Group Manager choice using the existing platform role.
export const ACCOUNT_ROLES = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'TREASURER', label: 'Treasurer' },
  { value: 'MEMBER', label: 'Member' },
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number]['value'];

export function roleLabel(value: string): string {
  return (
    ACCOUNT_ROLES.find((role) => role.value === value)?.label ??
    (value === 'GROUP_MANAGER'
      ? 'Admin'
      : value
          .replaceAll('_', ' ')
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()))
  );
}
