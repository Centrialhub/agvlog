import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('route dialog durable command recovery', () => {
  it('discards a definitively rejected request while preserving uncertain failures', () => {
    const source = readFileSync('src/components/routes/RouteDialog.tsx', 'utf8');
    expect(source).toContain('isDefinitiveOperatorCommandRejection(error)');
    expect(source).toContain('acknowledgeDurableOperatorCommand(pending)');
  });
});
