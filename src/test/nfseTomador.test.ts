import {it,expect} from 'vitest';
import {resolveNFSeTomador} from '@/lib/fiscal/nfseTomador';
import type {FiscalDocument} from '@/hooks/useFiscalDocuments';
const document={remitter:'Remetente',remitter_cnpj:'11222333000181',recipient:'Destinatario',recipient_cnpj:'20560843000150',recipient_city:'Montes Claros',recipient_state:'MG',delivery_meta:{remitter_city:'Sao Paulo',remitter_state:'SP',remitter_zip:'01001000',remitter_address:'Rua do remetente',remitter_cod_municipio:'3550308',recipient_zip:'39400182',recipient_address:'Rua do destinatario',recipient_cod_municipio:'3143302'}} as unknown as FiscalDocument;
it('keeps sender address with sender CNPJ even when recipient data is present',()=>{
 expect(resolveNFSeTomador(document,'remetente',[])).toMatchObject({cnpj:'11222333000181',municipio:'Sao Paulo',uf:'SP',cep:'01001000',endereco:'Rua do remetente',municipio_cod:'3550308'});
});
it('keeps recipient address with recipient CNPJ',()=>{
 expect(resolveNFSeTomador(document,'destinatario',[])).toMatchObject({cnpj:'20560843000150',municipio:'Montes Claros',uf:'MG',cep:'39400182',endereco:'Rua do destinatario'});
});
it('does not fill missing sender data from the recipient or another branch',()=>{
 const doc={...document,delivery_meta:{recipient_address:'Endereco errado'}} as FiscalDocument;
 expect(resolveNFSeTomador(doc,'remetente',[{id:'wrong',tax_id:'11222333000262',state_registration:'IE-ERRADA',address_city:'Cidade errada'}])).toMatchObject({endereco:'',municipio:'',uf:'',ie:'',cliente_id:null});
});
it('only supplements from the exact registered establishment',()=>{
 expect(resolveNFSeTomador(document,'destinatario',[{id:'branch',tax_id:'20560843000230',state_registration:'BAD'},{id:'correct',tax_id:'20.560.843/0001-50',state_registration:'1882510110074',address_street:'Rua cadastral'}])).toMatchObject({cliente_id:'correct',ie:'1882510110074',endereco:'Rua cadastral'});
});
it('never matches an empty document to an empty registry CNPJ',()=>{
 expect(resolveNFSeTomador({...document,remitter_cnpj:null},'remetente',[{id:'empty',tax_id:null}]).cliente_id).toBeNull();
});
