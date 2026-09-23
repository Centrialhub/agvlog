import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/routes/RouteDialog.tsx', 'utf8');

describe('leitura de pontos ao editar corredor', () => {
  it('limpa o estado anterior e expõe carregamento, falha e nova tentativa', () => {
    expect(source).toContain("setWaypoints([]);");
    expect(source).toContain("existingWaypointsQuery.isError");
    expect(source).toContain("Não foi possível carregar os pontos desta rota.");
    expect(source).toContain("existingWaypointsQuery.refetch()");
    expect(source).toContain("existingWaypointsQuery.isLoading");
  });

  it('não permite salvar até confirmar a leitura dos pontos', () => {
    expect(source).toContain("editRoute && !existingWaypointsQuery.isSuccess");
    expect(source).toContain("Aguarde ou tente novamente a leitura dos pontos antes de salvar.");
    expect(source).toContain("|| (editRoute != null && !existingWaypointsQuery.isSuccess)");
  });
});
