import {assessNominatimCandidate} from '../_shared/geocoding-quality.ts';
export interface GeocodingProviderCandidate {
 label:string;latitude:number;longitude:number;confidence:number;accuracy_m:number;
 bounds:number[]|null;provider:string;provider_type:string|null;quality:string;
}
export class GeoapifyError extends Error {
 constructor(public readonly status:number,public readonly code:string){super(code);this.name='GeoapifyError';}
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const score=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:0;
export function parseGeoapifyCandidates(raw:unknown,address:string,limit=5):GeocodingProviderCandidate[]{
 if(!object(raw)||!Array.isArray(raw.results))throw new GeoapifyError(502,'invalid_geocoding_response');
 return raw.results.slice(0,Math.min(5,Math.max(1,limit))).flatMap((item:unknown)=>{
  if(!object(item)||item.country_code!=='br'||typeof item.lat!=='number'||typeof item.lon!=='number'
   ||!Number.isFinite(item.lat)||!Number.isFinite(item.lon)||item.lat< -90||item.lat>90||item.lon< -180||item.lon>180)return [];
  const kind=typeof item.result_type==='string'?item.result_type.slice(0,80):'';
  const rank=object(item.rank)?item.rank:{};
  const heuristic=assessNominatimCandidate({addresstype:kind==='street'?'road':kind,
   display_name:typeof item.formatted==='string'?item.formatted:'',
   address:{house_number:item.housenumber,road:item.street,postcode:item.postcode}},address);
  // Meter values are conservative application classifications, not a measured
  // accuracy supplied by Geoapify. Only an exact numbered building can auto-pass.
  const precise=kind==='building'&&heuristic.quality==='address_exact'&&score(rank.confidence)>=0.95
   &&(rank.confidence_building_level===undefined||score(rank.confidence_building_level)>=0.95)
   &&(rank.confidence_city_level===undefined||score(rank.confidence_city_level)>=0.95);
  return [{label:(typeof item.formatted==='string'&&item.formatted.trim()?item.formatted:address).slice(0,500),
   latitude:item.lat,longitude:item.lon,provider:'geoapify',provider_type:kind||null,bounds:null,
   confidence:precise?Math.min(score(rank.confidence),heuristic.confidence):Math.min(0.79,score(rank.confidence),heuristic.confidence),
   accuracy_m:precise?heuristic.accuracy_m:Math.max(180,heuristic.accuracy_m),
   quality:precise?'address_exact':kind==='street'?'road_match':'locality_only'}];
 });
}
export async function queryGeoapify(address:string,key:string|undefined,limit=5,request:typeof fetch=fetch):Promise<GeocodingProviderCandidate[]>{
 if(!key?.trim()||key.length>512)throw new GeoapifyError(503,'geocoding_provider_not_configured');
 const endpoint=new URL('https://api.geoapify.com/v1/geocode/search');
 endpoint.searchParams.set('text',address);endpoint.searchParams.set('format','json');endpoint.searchParams.set('lang','pt');
 endpoint.searchParams.set('filter','countrycode:br');endpoint.searchParams.set('limit',String(Math.min(5,Math.max(1,limit))));
 endpoint.searchParams.set('apiKey',key.trim());
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await request(endpoint,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});
  if(!response.ok)throw new GeoapifyError(response.status===429?429:502,
   response.status===429?'geocoding_rate_limited':'geocoding_provider_unavailable');
  return parseGeoapifyCandidates(await response.json(),address,limit);
 }catch(error){
  if(controller.signal.aborted)throw new GeoapifyError(504,'geocoding_timeout');
  if(error instanceof GeoapifyError)throw error;
  // Fetch/JSON errors may contain the URL and API key. Never propagate them.
  throw new GeoapifyError(502,'geocoding_provider_unavailable');
 }finally{clearTimeout(timer);}
}
