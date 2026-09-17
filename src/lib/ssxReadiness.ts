export interface SsxReadinessInput {
  accounts?: Array<{status?:string|null}>;
  health?: Record<string,unknown>|null;
  positionStats?: {total:number;fresh:number}|null;
  mappingConflicts?: unknown[];
  now?:number;
}

const time=(value:unknown)=>typeof value==='string'?new Date(value).getTime():Number.NaN;
const HOUR_MS=60*60*1000;

function hasContinuousSuccessEvidence(health:Record<string,unknown>|null|undefined,now:number){
  if(!Array.isArray(health?.recent_automatic_poll_runs))return false;
  const successes=health.recent_automatic_poll_runs.map(time).filter(value=>Number.isFinite(value)&&value<=now&&now-value<24*HOUR_MS);
  const buckets=new Set(successes.map(value=>Math.floor((now-value)/HOUR_MS)));
  const failure=time(health.last_automatic_poll_failed_at);
  return Array.from({length:24},(_,bucket)=>buckets.has(bucket)).every(Boolean)
    &&(!Number.isFinite(failure)||now-failure>=24*HOUR_MS);
}

export function evaluateSsxReadiness({accounts=[],health,positionStats,mappingConflicts=[],now=Date.now()}:SsxReadinessInput){
  const firstSuccess=time(health?.first_automatic_poll_success_at);
  const lastSuccess=time(health?.last_automatic_poll_success_at);
  const rateLimit=time(health?.last_rate_limit_at);
  const gates=[
    {key:'authentication',label:'Integração SSX autenticada',met:accounts.length>0&&accounts.some(account=>account.status==='ok')},
    {key:'pipeline_24h',label:'Pipeline automático comprovado por 24h+',met:Number.isFinite(firstSuccess)&&now-firstSuccess>=24*HOUR_MS
      &&Number.isFinite(lastSuccess)&&now-lastSuccess<=30*60*1000&&hasContinuousSuccessEvidence(health,now)},
    {key:'fleet_map',label:'Fleet-map atualizando automaticamente',met:Boolean(positionStats&&positionStats.total>0&&positionStats.fresh>0)},
    {key:'rate_limit',label:'Sem rate limit na última hora',met:!Number.isFinite(rateLimit)||now-rateLimit>60*60*1000},
    {key:'mapping',label:'Conflitos de mapeamento visíveis e controlados',met:mappingConflicts.length===0},
    {key:'coverage',label:'Ao menos 80% dos veículos ativos com posição fresca',met:Boolean(positionStats&&positionStats.total>0&&positionStats.fresh/positionStats.total>=0.8)},
  ];
  return {gates,allMet:gates.every(gate=>gate.met)};
}
