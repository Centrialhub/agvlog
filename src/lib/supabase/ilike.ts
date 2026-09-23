/** Escapes PostgreSQL LIKE metacharacters so user input is matched literally. */
export function escapeIlikeLiteral(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function containsIlikePattern(value: string) {
  return `%${escapeIlikeLiteral(value)}%`;
}

/** Allows punctuation differences in identifiers without turning punctuation-only input into `%%`. */
export function flexibleIdentifierIlikePattern(value: string) {
  const compact = value.replace(/[^a-z0-9]/gi, '');
  return compact ? `%${compact.split('').join('%')}%` : containsIlikePattern(value);
}
