import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('driver accessibility contract', () => {
  it('keeps zoom enabled on mobile', () => {
    const html = read('index.html');
    const viewport = html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i)?.[1];
    expect(viewport).toBeDefined();
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1.0');
    expect(viewport).not.toContain('maximum-scale');
    expect(viewport).not.toContain('user-scalable=no');
  });

  it('associates expense labels with controls and names both comboboxes', () => {
    const page = read('src', 'pages', 'driver', 'DriverExpenses.tsx');
    const form = read('src', 'components', 'financial', 'ExpenseCreationForm.tsx');
    expect(page).toContain('<ExpenseCreationForm');
    expect(form).toContain('htmlFor={prefix+name}');
    expect(form).toContain('id={prefix+name}');
    for (const name of ['amount','expense_at','supplier_name','document_number','city','state','odometer','cost_center','no_receipt_reason']) {
      expect(form).toContain("textField('"+name+"',");
    }
    for (const name of ['category','payment','notes','receipt']) {
      expect(form).toContain("htmlFor={prefix+'"+name+"'}");
      expect(form).toContain("id={prefix+'"+name+"'}");
    }
    // SQL-integrated rendered tests also locate these by actual accessible name.
    expect(form).toContain('>Categoria</label>');
    expect(form).toContain('>Origem do pagamento</label>');
  });

  it('shows human event context instead of a technical code badge', () => {
    const page = read('src', 'pages', 'driver', 'DriverEvents.tsx');
    expect(page).toContain('{evt.observation}');
    expect(page).not.toContain('{evt.code}');
    expect(page).toContain('htmlFor="driver-event-search"');
  });
});
