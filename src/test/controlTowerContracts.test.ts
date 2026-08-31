import {describe,expect,it} from 'vitest';
import {escapeMarkerText,requireRouteResult} from '@/lib/controlTower/contracts';
describe('Control Tower boundary helpers',()=>{
 it('escapes database text before it is inserted into a Leaflet HTML marker',()=>{
  expect(escapeMarkerText('<img src=x onerror="alert(1)"> & \'QA\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;QA&#39;');
 });
 it.each([{data:null,error:null},{data:{error:'failed'},error:null},{data:{ok:false},error:null},{data:{ok:true},error:new Error('HTTP 403')}])('requires a confirmed route result (%j)',result=>{
  expect(()=>requireRouteResult(result)).toThrow(/não confirmou/);
 });
 it('accepts a confirmed result',()=>{expect(()=>requireRouteResult({data:{ok:true},error:null})).not.toThrow();});
});
