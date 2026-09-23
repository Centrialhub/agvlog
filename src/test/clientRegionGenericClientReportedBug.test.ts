import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/ClientRegions.tsx', 'utf8');

describe('região genérica para todos os clientes', () => {
  it('permite limpar uma seleção de cliente no cadastro e na edição', () => {
    expect(page).toContain("value={form.client_id || '__all_clients__'}");
    expect(page).toContain("client_id: value === '__all_clients__' ? '' : value");
    expect(page).toContain('<SelectItem value="__all_clients__">— Todos os clientes (região genérica)</SelectItem>');
  });

  it('continua persistindo a opção genérica como null', () => {
    expect(page).toContain('client_id: values.client_id || null');
  });
});
