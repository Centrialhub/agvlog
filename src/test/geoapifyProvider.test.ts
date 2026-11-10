// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {parseGeoapifyCandidates,queryGeoapify} from '../../supabase/functions/geocode-address/geoapify';
const address='Rua Exemplo, 10, Cidade, MG, Brasil';
export const exact={country_code:'br',lat:-16,lon:-44,formatted:address,result_type:'building',street:'Rua Exemplo',housenumber:'10',
 rank:{confidence:1,confidence_building_level:1,confidence_city_level:1,match_type:'full_match'}};
afterEach(()=>vi.useRealTimers());
it('confirms an exact numbered Brazilian building while preserving provenance',()=>{
 expect(parseGeoapifyCandidates({results:[exact]},address)).toEqual([{label:address,latitude:-16,longitude:-44,
  confidence:0.96,accuracy_m:30,bounds:null,provider:'geoapify',provider_type:'building',quality:'address_exact'}]);
});
it('never promotes a street, city, wrong number or uncertain building into an automatic precise point',()=>{
 for(const item of [{...exact,result_type:'city'},{...exact,result_type:'street'},{...exact,housenumber:'999'},
  {...exact,rank:{...exact.rank,confidence:0.6}},{...exact,rank:{...exact.rank,confidence_building_level:0.2}},
  {...exact,rank:{...exact.rank,confidence_city_level:0.2}},{...exact,rank:{match_type:'full_match'}}]){
  const result=parseGeoapifyCandidates({results:[item]},address)[0];expect(result.confidence).toBeLessThan(0.8);
  expect(result.accuracy_m).toBeGreaterThan(150);expect(result.quality).not.toBe('address_exact');
 }
});
it('rejects malformed roots and skips foreign, missing or impossible coordinates',()=>{
 for(const root of [null,[],{}, {results:'unexpected'}])expect(()=>parseGeoapifyCandidates(root,address)).toThrow('invalid_geocoding_response');
 expect(parseGeoapifyCandidates({results:[{...exact,country_code:'us'},{...exact,lat:999},{...exact,lat:null},{...exact,lon:NaN}]},address)).toEqual([]);
 expect(parseGeoapifyCandidates({results:Array(20).fill(exact)},address)).toHaveLength(5);
});
it('uses only the fixed provider endpoint and sends the unchanged address snapshot with a server key',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({results:[exact]})));
 await queryGeoapify(address,'synthetic-server-key',5,request);
 const endpoint=new URL(String(request.mock.calls[0][0]));expect(endpoint.origin).toBe('https://api.geoapify.com');
 expect(endpoint.pathname).toBe('/v1/geocode/search');expect(endpoint.searchParams.get('text')).toBe(address);
 expect(endpoint.searchParams.get('filter')).toBe('countrycode:br');expect(endpoint.searchParams.get('apiKey')).toBe('synthetic-server-key');
 expect(request.mock.calls[0][1]?.redirect).toBe('error');
});
it('missing credentials never call a provider or silently fall back',async()=>{
 const request=vi.fn<typeof fetch>();await expect(queryGeoapify(address,undefined,5,request)).rejects.toMatchObject({status:503,code:'geocoding_provider_not_configured'});
 expect(request).not.toHaveBeenCalled();
});
it('does not leak credential-bearing URLs, provider payloads or JSON parser errors',async()=>{
 const privateKey='synthetic-do-not-return';
 for(const request of [vi.fn<typeof fetch>().mockRejectedValue(new Error('https://api.geoapify.com/?apiKey='+privateKey)),
  vi.fn<typeof fetch>().mockResolvedValue(new Response(privateKey))]){
  await expect(queryGeoapify(address,privateKey,5,request)).rejects.toMatchObject({message:'geocoding_provider_unavailable',status:502});
 }
 for(const status of [401,403,429,500]){
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(privateKey,{status}));
  await expect(queryGeoapify(address,privateKey,5,request)).rejects.toMatchObject({status:status===429?429:502,
   message:status===429?'geocoding_rate_limited':'geocoding_provider_unavailable'});
 }
});
it('bounds slow requests and reports a sanitized timeout',async()=>{
 vi.useFakeTimers();const request=vi.fn<typeof fetch>().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>{
  options?.signal?.addEventListener('abort',()=>reject(new Error('private URL')), {once:true});
 }));const pending=expect(queryGeoapify(address,'synthetic-server-key',5,request)).rejects.toMatchObject({status:504,code:'geocoding_timeout'});
 await vi.advanceTimersByTimeAsync(8000);await pending;
});
