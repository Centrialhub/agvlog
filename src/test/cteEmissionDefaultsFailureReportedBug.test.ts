import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source=readFileSync('src/components/billing/CteEmissionPreviewDialog.tsx','utf8');

describe('falha ao carregar padrões da prévia de CT-e',()=>{
  it('trata erro e resposta inválida como falha visível com retry',()=>{
    expect(source).toContain('if(error)throw error');
    expect(source).toContain("setDefaultsStatus('error')");
    expect(source).toContain('Não foi possível carregar os padrões do grupo:');
    expect(source).toContain('setDefaultsRetry(value=>value+1)');
  });

  it('bloqueia a transmissão até a leitura íntegra terminar',()=>{
    expect(source).toContain("if(defaultsStatus!=='ready')");
    expect(source).toContain("defaultsStatus!=='ready'} onClick={handleTransmitClick}");
  });
});
