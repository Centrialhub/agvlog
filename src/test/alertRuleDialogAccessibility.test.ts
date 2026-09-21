import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Alerts.tsx', 'utf8');

describe('alert rule dialog accessibility', () => {
  it('describes the alert rule form for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Configure o evento monitorado e o limite que deve gerar novos alertas.');
  });
});
