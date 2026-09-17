import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedBody} from '../../supabase/functions/secure-upload/bounded-request.ts';
test('bounded multipart body preserves bytes',async()=>{
 const bytes=await readBoundedBody({body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}})},3);
 assert.deepEqual([...bytes],[1,2,3]);
});
test('oversized body cancels the input stream before form parsing',async()=>{
 let cancelled=false;
 await assert.rejects(readBoundedBody({body:new ReadableStream({start(c){c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}})},3),/upload_body_too_large/);
 assert.equal(cancelled,true);
});
test('stalled body fails closed and cancels the stream',async()=>{
 let cancelled=false;
 await assert.rejects(readBoundedBody({body:new ReadableStream({cancel(){cancelled=true;}})},3,10),/upload_body_timeout/);
 assert.equal(cancelled,true);
});