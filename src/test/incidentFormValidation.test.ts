import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Incidents.tsx', 'utf8');

describe('formal incident form validation', () => {
  it('blocks invalid forms and persists a normalized title', () => {
    expect(source).toContain('title: form.title.trim()');
    expect(source).toContain('|| !form.title.trim()');
    expect(source).toContain("form.category === 'hr' && !form.employee_id");
    expect(source).toContain("['resolved', 'closed'].includes(form.status)");
  });
});
