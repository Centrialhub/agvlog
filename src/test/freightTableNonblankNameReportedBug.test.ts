import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightTables.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260922027000_reject_blank_freight_table_names.sql', 'utf8');

describe('nome obrigatório da tabela de frete', () => {
  it('normaliza e valida o nome antes de persistir', () => {
    expect(page).toContain("const tableName = values.table_name.trim().replace(/\\s+/g, ' ')");
    expect(page).toContain("if (!tableName) throw new Error('Informe um nome para a tabela de frete.')");
    expect(page).toContain('table_name: tableName');
    expect(page).toContain('disabled={!form.table_name.trim() || !form.valid_from}');
  });

  it('rejeita gravação direta de nome vazio no banco', () => {
    expect(migration).toContain('constraint freight_tables_nonblank_name');
    expect(migration).toContain("check (btrim(table_name) <> '') not valid");
  });
});
