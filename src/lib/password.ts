// Password helpers shared by the sign-in page, the "choose a new password" screen and the owner's reset dialog.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/l/I: easy to read out over the phone
const LETTERS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** A temporary password the owner can read to a staff member. Uses the browser's secure random generator. */
export function generateTempPassword(len = 12, rand: (n: number) => Uint32Array = n => crypto.getRandomValues(new Uint32Array(n))): string {
  const r = rand(len);
  const c = Array.from(r, n => ALPHABET[n % ALPHABET.length]);
  c[0] = LETTERS[r[0] % LETTERS.length];   // always at least one letter and one digit, so it passes passwordProblem()
  c[1] = DIGITS[r[1] % DIGITS.length];
  return c.join('');
}

/** null when the password is acceptable, otherwise a plain sentence for the person. */
export function passwordProblem(pw: string, confirm?: string): string | null {
  if (pw.length < 8) return 'The password must be at least 8 characters.';
  if (pw.length > 72) return 'The password is too long (72 characters at most).';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.';
  if (confirm !== undefined && pw !== confirm) return 'The two passwords do not match.';
  return null;
}
