import {act,renderHook} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import {useDocumentMetadataDrafts} from '@/hooks/useDocumentMetadataDrafts';
import type {MetadataContext} from '@/lib/loads/documentMetadata';
const id=(n:number)=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(2),load=id(3),doc=id(4);
const context=():MetadataContext=>({tenant_id:tenant,load_id:load,document_id:doc,attempt_id:null,outcome_id:null,revision:'a'.repeat(64),status:'confirmed',
 fields:{rec_canhoto:false,payment_method:'',oco_01:'',oco_02:'',resp_oco:''},can_receive_receipt:false});
const properties=()=>({tenant,actor,load,documents:[{id:doc,operational_metadata:context()}],blocked:false});
const mount=()=>renderHook(p=>useDocumentMetadataDrafts(p.tenant,p.actor,p.load,p.documents,p.blocked),{initialProps:properties()});
describe('metadata drafts remain bound to explicitly reviewed identity',()=>{
 it('stages only changed fields and removes a reverted patch without mutating the server row',()=>{
  const props=properties();const view=renderHook(p=>useDocumentMetadataDrafts(p.tenant,p.actor,p.load,p.documents,p.blocked),{initialProps:props});
  act(()=>view.result.current.patch(doc,{payment_method:'pix'}));expect(view.result.current.items()[0].changes).toEqual({payment_method:'pix'});
  expect(props.documents[0].operational_metadata.fields.payment_method).toBe('');act(()=>view.result.current.patch(doc,{payment_method:''}));expect(view.result.current.dirty.size).toBe(0);
 });
 it('does not silently rebase when a refetch changes metadata in the same attempt',()=>{
  const view=mount();act(()=>view.result.current.patch(doc,{payment_method:'pix'}));
  const next=properties();next.documents[0].operational_metadata.revision='b'.repeat(64);next.documents[0].operational_metadata.fields.payment_method='boleto';view.rerender(next);
  expect(view.result.current.stale).toEqual([doc]);expect(view.result.current.canEdit(doc)).toBe(false);expect(view.result.current.items()[0].revision).toBe('a'.repeat(64));
  act(()=>expect(view.result.current.rebase()).toBe(true));expect(view.result.current.items()[0]).toMatchObject({revision:'b'.repeat(64),changes:{payment_method:'pix'}});
 });
 it.each(['attempt_id','outcome_id'] as const)('cannot carry a draft into a different %s',key=>{
  const view=mount();act(()=>view.result.current.patch(doc,{payment_method:'pix'}));const next=properties();next.documents[0].operational_metadata[key]=id(9);next.documents[0].operational_metadata.revision='b'.repeat(64);view.rerender(next);
  act(()=>expect(view.result.current.rebase()).toBe(false));expect(view.result.current.stale).toEqual([doc]);
 });
 it.each(['tenant','actor','load'] as const)('isolates unsent drafts after a %s switch',key=>{
  const view=mount();act(()=>view.result.current.patch(doc,{payment_method:'pix'}));view.rerender({...properties(),[key]:id(9)});
  expect(view.result.current.dirty.size).toBe(0);expect(view.result.current.items()).toEqual([]);
 });
 it('cannot rebase a note removed from the current load',()=>{
  const view=mount();act(()=>view.result.current.patch(doc,{payment_method:'pix'}));view.rerender({...properties(),documents:[]});
  expect(view.result.current.stale).toEqual([doc]);act(()=>expect(view.result.current.rebase()).toBe(false));expect(view.result.current.items()).toHaveLength(1);
 });
 it('does not accept edits while a request is pending or recovery is unavailable',()=>{
  const view=mount();view.rerender({...properties(),blocked:true});act(()=>view.result.current.patch(doc,{payment_method:'pix'}));expect(view.result.current.items()).toEqual([]);
 });
});
