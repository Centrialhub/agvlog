import { describe, it, expect } from 'vitest';
import { buildCtePayload, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import { subcontractingFixture } from './helpers/subcontractingFixture';
const selection = subcontractingFixture();
const address = { street:'Rua QA', number:'1', neighborhood:'Centro', city:'São Paulo', state:'SP', zip:'01001000', city_ibge:'3550308' };
function input(): BuildCtePayloadInput {
  return { serviceType:'1', subcontracting:structuredClone(selection), documentType:'01', cfop:'6351', emitter:{ id:'e1', name:'Emitente QA', cnpj:'11222333000181', ie:'123456789', environment:'production', address },
    remitter:{ name:'Remetente QA', cnpj:'11444777000161', ie:'123456789', address }, recipient:{ name:'Destinatário QA', cnpj:'22333444000181', ie:'123456789', address },
    takerRole:'remetente', driver:null, vehicle:null, nature:'TRANSPORTE', insurer:{name:'Seguradora QA',cnpj:'11222333000181',policy:'QA-001',endorsement:'QA-001'},
    invoices:[{ access_key:'1'.repeat(44), number:'1' }], totals:{ freight_value:100, cargo_value:1000, weight_kg:100, pallet_count:1 } };
}
describe('subcontratação no builder (sem emissão)', () => {
  it('gera referência, trajeto original e tomador contratante sem mudar remetente/frete', () => {
    const result=buildCtePayload(input());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ contractorCteSource:{ id:selection.source.id, sha256:selection.source.original_sha256 }, payload:{ tipoServico:'1', tipoCtrc:'01',
      inicio:{codigoCidade:'3143302',uf:'MG'},fim:{codigoCidade:'3550308',uf:'SP'}, CFOP:'6351',
      documentoAnterior:{chave:selection.source.access_key,cnpj:selection.source.document.issuer_cnpj},
      tomador:{role:'terceiro',cnpj:selection.source.document.issuer_cnpj}, remetente:{cnpj:'11444777000161'}, valores:{valorFrete:100} } });
  });
  it('bloqueia fonte ausente, outro ambiente, mesmo emitente, falta de conferência e trajeto incompleto', () => {
    for (const change of [
      (p:BuildCtePayloadInput)=>{p.subcontracting=null;},
      (p:BuildCtePayloadInput)=>{p.emitter!.environment='homologation';},
      (p:BuildCtePayloadInput)=>{p.emitter!.cnpj=selection.source.document.issuer_cnpj;},
      (p:BuildCtePayloadInput)=>{p.subcontracting!.confirmed=false;},
      (p:BuildCtePayloadInput)=>{p.subcontracting!.originName='';},
      (p:BuildCtePayloadInput)=>{p.documentType='04';},
      (p:BuildCtePayloadInput)=>{p.cfop='';},
      (p:BuildCtePayloadInput)=>{p.cfop='0000';},
      (p:BuildCtePayloadInput)=>{p.subcontracting!.source.document.referenced_nfe_keys=['2'.repeat(44)];},
    ]) { const p=input();change(p);expect(buildCtePayload(p).ok).toBe(false); }
  });
  it('serviço normal não recebe referência e mantém origem do emitente', () => {
    const p=input();p.serviceType='0';p.subcontracting=null;
    const body=buildCtePayload(p).payload;
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('contractorCteSource');
    expect(body.payload).toMatchObject({inicio:{codigoCidade:'3550308'}});
    expect((body.payload as Record<string,unknown>).documentoAnterior).toBeUndefined();
  });
});
