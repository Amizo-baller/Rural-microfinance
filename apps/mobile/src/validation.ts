export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateRangeError(from: string, to: string): string | null {
  if ((from && !isValidDate(from)) || (to && !isValidDate(to)))
    return 'Enter a real date in YYYY-MM-DD format.';
  if (from && to && from > to) return 'The end date must be on or after the start date.';
  return null;
}

export type RegistrationFields = {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmation: string;
  groupId: string;
};
export function registrationErrors(
  fields: RegistrationFields,
): Partial<Record<keyof RegistrationFields, string>> {
  const errors: Partial<Record<keyof RegistrationFields, string>> = {};
  if (!fields.memberId?.trim() || !/^[A-Za-z0-9-]{3,50}$/.test(fields.memberId.trim())) errors.memberId = 'Enter your unique member ID, for example 2026001.';
  if (fields.firstName.trim().length < 2) errors.firstName = 'Enter at least two characters.';
  if (fields.lastName.trim().length < 2) errors.lastName = 'Enter at least two characters.';
  if (!fields.email.trim() && !fields.phone.trim())
    errors.phone = 'Enter an email address or phone number.';
  if (fields.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim()))
    errors.email = 'Enter a valid email address.';
  if (fields.phone.trim() && !/^\+?[0-9]{7,30}$/.test(fields.phone.trim()))
    errors.phone = 'Use 7 to 30 digits, with an optional + prefix.';
  if (fields.password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(fields.password))
    errors.password = 'Use at least 8 characters, including uppercase, lowercase, and a number.';
  if (fields.confirmation !== fields.password) errors.confirmation = 'Passwords must match.';
  if (
    fields.groupId.trim() &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      fields.groupId.trim(),
    )
  )
    errors.groupId = 'Enter a valid group ID, or leave this blank.';
  return errors;
}
