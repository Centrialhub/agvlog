/** Escapes a semicolon-delimited CSV cell and neutralizes Excel formulas. */
export function csvSafeCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const neutralized = /^\s*[=+\-@]/.test(raw) || /^[\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r]/.test(neutralized)
    ? `"${neutralized.replace(/"/g, '""')}"`
    : neutralized;
}
