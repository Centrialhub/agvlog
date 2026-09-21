import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/clients/ClientFormDialog.tsx', 'utf8');

describe('client and supplier form dialog', () => {
  it('uses the selected entity kind in create and edit titles', () => {
    expect(source).toContain("defaultKind === 'supplier' ? 'Fornecedor' : 'Cliente'");
    expect(source).toContain('`Novo ${entityLabel}`');
    expect(source).toContain('`Editar ${entityLabel} — ${client.company_name}`');
  });

  it('describes the purpose of the dialog for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('dados cadastrais, tributários e comerciais');
  });
});
