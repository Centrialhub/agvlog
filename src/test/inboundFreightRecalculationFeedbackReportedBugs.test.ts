import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useRecalculateInboundFreight.tsx','utf8');
const billing=readFileSync('src/pages/BillingPage.tsx','utf8');
const nfse=readFileSync('src/components/nfse/NFSeFromInvoicesDialog.tsx','utf8');

describe('feedback do recálculo em lote de frete de entrada',()=>{
  it('captura falhas de preparação nos dois consumidores',()=>{
    expect(billing).toContain("toast.error('Não foi possível recalcular os fretes'");
    expect(nfse).toContain("toast.error('Não foi possível recalcular os fretes'");
    expect(nfse).toMatch(/catch \(error\)[\s\S]*finally/);
  });

  it('não anuncia sucesso quando há falhas e identifica as NF-es',()=>{
    expect(hook).toContain('failedIds.push(d.id)');
    for(const consumer of [billing,nfse]){
      expect(consumer).toContain('failedIds.slice(0, 10)');
      expect(consumer).toContain('failed === 0');
      expect(consumer).toContain('toast.warning(message)');
    }
  });
});
