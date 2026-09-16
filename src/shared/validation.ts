/** Username and password rules, shared by client (live feedback) and server (enforcement). */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const USERNAME_HINT = `${USERNAME_MIN} to ${USERNAME_MAX} characters: letters, numbers and underscores.`;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters.`;

/** Returns a specific, human message about what is wrong with the username, or null if it is fine. */
export function usernameProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return 'Enter a username.';
  const u = raw;
  if (/\s/.test(u)) return 'No spaces allowed. Try an underscore instead.';
  const bad = Array.from(new Set(u.match(/[^A-Za-z0-9_]/g) ?? []));
  if (bad.length) {
    return `Only letters, numbers and underscores. Remove: ${bad.map((c) => `"${c}"`).join(' ')}`;
  }
  if (u.length < USERNAME_MIN) return `Too short: ${u.length} of at least ${USERNAME_MIN} characters.`;
  if (u.length > USERNAME_MAX) return `Too long: ${u.length} characters, the maximum is ${USERNAME_MAX}.`;
  return null;
}

/** Returns a specific message about what is wrong with the password, or null if it is fine. */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return 'Enter a password.';
  if (raw.length < PASSWORD_MIN) {
    const missing = PASSWORD_MIN - raw.length;
    return `Too short: ${raw.length} of at least ${PASSWORD_MIN} characters. Add ${missing} more.`;
  }
  if (raw.length > PASSWORD_MAX) return `Too long: the maximum is ${PASSWORD_MAX} characters.`;
  return null;
}
