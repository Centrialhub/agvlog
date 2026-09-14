import {describe,it,expect} from 'vitest';
import {uploadArtifactError} from '@/lib/financial/uploadArtifactError';
describe('safe upload diagnostics',()=>{
 it('keeps an allowlisted Edge code and preserves the response for other consumers',async()=>{
  const context=new Response(JSON.stringify({error:'tenant_context_mismatch',token:'secret'}),{status:409});
  const error=await uploadArtifactError({context});
  expect(error.message).toContain('HTTP 409');expect(error.message).toContain('tenant_context_mismatch');expect(error.message).not.toContain('secret');expect(context.bodyUsed).toBe(false);
 });
 it('recognizes nested CORS codes without echoing server details',async()=>{
  const error=await uploadArtifactError({context:new Response(JSON.stringify({error:{code:'ORIGIN_NOT_ALLOWED',message:'private'}}),{status:403})});
  expect(error.message).toContain('ORIGIN_NOT_ALLOWED');expect(error.message).not.toContain('private');
 });
 it('does not echo unknown codes or text bodies',async()=>{
  for(const body of [JSON.stringify({error:'private-person-123'}),'<html>private-person-123</html>']){
   const error=await uploadArtifactError({context:new Response(body,{status:500})});
   expect(error.message).toContain('HTTP 500');expect(error.message).not.toContain('private-person');expect(error.message).toContain('mesmo arquivo');
  }
 });
 it('handles network, malformed context and already consumed response',async()=>{
  const consumed=new Response('bad',{status:503});await consumed.text();
  for(const error of [null,new Error('Bearer secret'),{context:'secret'},{context:{json:()=>{throw Error('secret');}}},{context:consumed}]){
   const result=await uploadArtifactError(error);expect(result.message).not.toContain('secret');expect(result.message).toContain('preservado');
  }
 });
});
