import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/DriverMonitoring.tsx', 'utf8');

describe('driver monitoring form validation', () => {
  it('blocks invalid delivery totals and return deadlines', () => {
    expect(source).toContain('const monitorFormInvalid =');
    expect(source).toContain('createForm.deadline < 0 || createForm.deadline > 3650');
    expect(source).toContain('!!monitorCommand.pending || monitorFormInvalid');
  });

  it('describes every monitoring dialog', () => {
    expect(source.match(/<DialogContent/g)).toHaveLength(4);
    expect(source.match(/<DialogDescription>/g)).toHaveLength(4);
  });
});
