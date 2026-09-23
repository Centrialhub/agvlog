import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const regions = readFileSync('src/pages/ClientRegions.tsx', 'utf8');
const tables = readFileSync('src/pages/FreightTables.tsx', 'utf8');

describe('ações administrativas de configuração de frete', () => {
  it.each([
    ['regiões', regions, 'alterar regiões', 'remover regiões'],
    ['tabelas', tables, 'alterar tabelas de frete', 'remover tabelas de frete'],
  ])('protege mutações e ações visuais de %s pelo perfil administrativo', (_name, source, editMessage, deleteMessage) => {
    expect(source).toContain('const isAdmin = useIsAdmin()');
    expect(source).toContain(`if (!isAdmin) throw new Error('Apenas administradores podem ${editMessage}.')`);
    expect(source).toContain(`if (!isAdmin) throw new Error('Apenas administradores podem ${deleteMessage}.')`);
    expect(source).toContain('{isAdmin && <TableHead className="w-20">Ações</TableHead>}');
    expect(source).toMatch(/\{isAdmin && <TableCell>[\s\S]{0,400}openEdit/);
  });

  it('oculta também criação e importação para operadores', () => {
    expect(regions).toContain('{isAdmin && <>');
    expect(tables).toContain('{isAdmin && <Dialog open={dialogOpen}');
  });
});
