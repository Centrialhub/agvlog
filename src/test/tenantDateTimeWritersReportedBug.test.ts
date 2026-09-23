import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localDateTimeInputToIso } from '@/lib/utils/formatDate';

describe('fuso do tenant nos escritores de data e hora', () => {
  it('interpreta o relógio civil de Manaus no instante UTC correto', () => {
    expect(localDateTimeInputToIso('2026-09-22T10:00', 'America/Manaus')).toBe('2026-09-22T14:00:00.000Z');
  });

  it.each([
    'src/components/fleet/FuelingTab.tsx',
    'src/components/driver/DriverExpenseForm.tsx',
    'src/components/financial/ExpenseCreationForm.tsx',
    'src/components/pickup/NewPickupOrderDialog.tsx',
    'src/components/pickup/NewManualOrtDialog.tsx',
  ])('%s envia o timezone ao conversor', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/localDateTimeInputToIso\([^\n]+(?:timeZone|tenantTimeZone)/);
  });
});
