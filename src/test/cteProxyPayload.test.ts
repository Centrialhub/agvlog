import { it, expect } from 'vitest';
import { normalizeCteEmissionBody, resolveCteSubcontractingBody } from '../../supabase/functions/_shared/cte-proxy-payload';
it('resolves subcontracting only for the same tenant, emitter and environment, with a source fingerprint',()=>{
  const body={environment:'production',contractorCteSource:{id:'source',sha256:'a'.repeat(64)},payload:{tipoServico:'1'}};
  const row={tenant_id:'tenant',emitter_id:'emitter',cte_payload:body};
  const scope={tenantId:'tenant',emitterId:'emitter',fiscalDocumentId:'fiscal'};
  expect(resolveCteSubcontractingBody(body,row,scope)).toMatchObject({...body,externalId:'agvlog-cte-fiscal'});
  for(const bad of [{...scope,tenantId:'other'},{...scope,emitterId:'other'},{...scope,fiscalDocumentId:undefined}]) expect(resolveCteSubcontractingBody(body,row,bad)).toBeNull();
  expect(resolveCteSubcontractingBody({...body,environment:'homologation'},row,scope)).toBeNull();
  expect(resolveCteSubcontractingBody(body,{...row,cte_payload:{...body,contractorCteSource:null}},scope)).toBeNull();
});
it('normal service still replaces the route from emitter/delivery, while subcontracting keeps its original route',()=>{
  const payload={CFOP:'5351',inicio:{uf:'SP',codigoCidade:'3550308',municipio:'SAO PAULO'},fim:{uf:'PR',codigoCidade:'4106902',municipio:'CURITIBA'},
    emitente:{endereco:{uf:'MG',codigoCidade:'3143302',municipio:'MONTES CLAROS'}},destinatario:{endereco:{uf:'MG',codigoCidade:'3143302',municipio:'MONTES CLAROS'}}};
  const normal=normalizeCteEmissionBody({payload});
  expect(normal).toMatchObject({payload:{inicio:{uf:'MG'},fim:{uf:'MG'},CFOP:'5351'}});
  const subcontracting=normalizeCteEmissionBody({payload:{...payload,tipoServico:'1'}});
  expect(subcontracting).toMatchObject({payload:{inicio:{uf:'SP'},fim:{uf:'PR'},CFOP:'6351'}});
  expect(payload.CFOP).toBe('5351');
});
