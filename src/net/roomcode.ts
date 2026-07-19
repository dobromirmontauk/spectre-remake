// 5-character Crockford base32 room codes, drawn via crypto.getRandomValues
// for uniform randomness. Alphabet excludes I/L/O/U (Crockford's own
// exclusions, avoiding visual confusion with 1/0/0/V) *and* 0/1 themselves
// per the plan — 30 unambiguous symbols.

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 5;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

// Normalizes a user-typed code for comparison/joining: uppercase, and strip
// whitespace/dashes (people naturally type/paste codes as "AB3-DE" or
// "ab3 de"). Does not validate charset — an unrecognized code simply won't
// match any live room and surfaces as the ordinary "room not found" timeout.
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
