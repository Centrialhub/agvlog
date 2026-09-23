import { describe, expect, it } from 'vitest';
import { containsIlikePattern, escapeIlikeLiteral, flexibleIdentifierIlikePattern } from '@/lib/supabase/ilike';

describe('filtros literais do Monitor de CT-e', () => {
  it('escapa curingas e a própria barra invertida', () => {
    expect(escapeIlikeLiteral(String.raw`100%_\filial`)).toBe(String.raw`100\%\_\\filial`);
    expect(containsIlikePattern('%_')).toBe(String.raw`%\%\_%`);
  });

  it('mantém texto comum em uma busca de conteúdo', () => {
    expect(containsIlikePattern('São José')).toBe('%São José%');
  });

  it('não converte identificadores compostos apenas por curingas em busca universal', () => {
    expect(flexibleIdentifierIlikePattern('ABC-123')).toBe('%A%B%C%1%2%3%');
    expect(flexibleIdentifierIlikePattern('%_')).toBe(String.raw`%\%\_%`);
  });
});
