import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Traceability.tsx', 'utf8');

describe('traceability event form validation', () => {
  it('blocks short descriptions and persists normalized text', () => {
    expect(source).toContain("const eventFormInvalid = eventForm.description.trim().length < 5");
    expect(source).toContain('disabled={eventFormInvalid || registerEvent.isPending || !!registerEvent.pendingCommand}');
    expect(source).toContain('description: eventForm.description.trim()');
  });

  it('describes every traceability dialog', () => {
    expect(source.match(/<DialogContent/g)).toHaveLength(2);
    expect(source.match(/<DialogDescription>/g)).toHaveLength(2);
  });
});
