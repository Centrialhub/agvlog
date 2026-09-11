import type { Json } from '@/integrations/supabase/types';
import type {
  DriverOfflineEnvelope,
  DriverOfflineKind,
  DriverOfflineState,
} from '@/lib/driver/driverOfflineOutbox';

export const DRIVER_OUTBOX_KINDS:DriverOfflineKind[]=[
  'delivery','expense','arrival','departure','journey','checklist','occurrence','cargo',
];
export const DRIVER_OUTBOX_STATES:DriverOfflineState[]=['queued','syncing','needs_attention'];
export const DRIVER_GEOFENCE_ERROR_CATEGORIES=[
  'permission_denied','location_unavailable','low_accuracy','outside_geofence','server_rejection',
] as const;
export type DriverGeofenceErrorCategory=typeof DRIVER_GEOFENCE_ERROR_CATEGORIES[number];

export interface DriverBuildInfo {
  version:string;
  buildHash:string;
  builtAt:string;
}

export interface DriverOutboxSummary {
  total:number;
  byState:Record<DriverOfflineState,number>;
  byKind:Record<DriverOfflineKind,number>;
  documentConflicts:number;
  uploadFailures:{total:number;affectedItems:number;byKind:Record<DriverOfflineKind,number>};
  geofenceErrors:Record<DriverGeofenceErrorCategory,number>;
}

export interface DriverAppHeartbeatPayload {
  version:1;
  tenant_id:string;
  installation_id:string;
  app_version:string;
  build_hash:string;
  last_successful_sync_at:string|null;
  outbox:{
    total:number;
    by_state:Record<DriverOfflineState,number>;
    by_kind:Record<DriverOfflineKind,number>;
  };
  document_conflicts:number;
  upload_failures:{total:number;affected_items:number;by_kind:Record<DriverOfflineKind,number>};
  geofence_errors:Record<DriverGeofenceErrorCategory,number>;
}

export interface DriverAppDeviceSnapshot {
  installationCode:string;
  actorCode:string;
  appVersion:string;
  buildHash:string;
  lastSuccessfulSyncAt:string|null;
  outbox:DriverAppHeartbeatPayload['outbox'];
  documentConflicts:number;
  uploadFailures:DriverAppHeartbeatPayload['upload_failures'];
  geofenceErrors:Record<DriverGeofenceErrorCategory,number>;
  seenAt:string;
}

export interface DriverAppObservabilityReport {
  generatedAt:string|null;
  totalDevices:number;
  active24h:number;
  geofenceErrors:{invalidPosition:number;trackerIdentity:number;temporalBinding:number;addressResolution:number;processing:number};
  devices:DriverAppDeviceSnapshot[];
}

const localPrefix='agvlog:driver-observability:v1';
const zeroRecord=<T extends string>(keys:readonly T[]):Record<T,number>=>Object.fromEntries(keys.map(key=>[key,0])) as Record<T,number>;
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown):number=>typeof value==='number'&&Number.isInteger(value)&&value>=0?value:0;
const text=(value:unknown):string|null=>typeof value==='string'&&value.length>0?value:null;

function deliveryAttentionKind(row:DriverOfflineEnvelope):string|null{
  if(row.kind!=='delivery')return null;
  const payload=object(row.payload),attention=object(payload.attention);
  return text(attention.kind);
}

export function categorizeDriverGeofenceError(message:string|null):DriverGeofenceErrorCategory|null{
  if(!message)return null;
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/permission|permissao|denied|negad/.test(normalized))return 'permission_denied';
  if(/accuracy|precisao|imprecis|low_accuracy/.test(normalized))return 'low_accuracy';
  if(/outside|fora (da|do)|distance|distancia|geofence/.test(normalized))return 'outside_geofence';
  if(/unavailable|indisponivel|position|posicao|gps|location|localizacao/.test(normalized))return 'location_unavailable';
  return 'server_rejection';
}

export function summarizeDriverOutbox(rows:DriverOfflineEnvelope[]):DriverOutboxSummary{
  const byState=zeroRecord(DRIVER_OUTBOX_STATES),byKind=zeroRecord(DRIVER_OUTBOX_KINDS);
  const uploadFailuresByKind=zeroRecord(DRIVER_OUTBOX_KINDS);
  const geofenceErrors=zeroRecord(DRIVER_GEOFENCE_ERROR_CATEGORIES);
  let documentConflicts=0,uploadFailureTotal=0,uploadFailureItems=0;
  for(const row of rows){
    byState[row.state]+=1;byKind[row.kind]+=1;
    const failures=count(row.uploadFailures);
    if(failures){uploadFailureTotal+=failures;uploadFailureItems+=1;uploadFailuresByKind[row.kind]+=failures;}
    if(['local_evidence_conflict','remote_conflict'].includes(deliveryAttentionKind(row)??''))documentConflicts+=1;
    if(row.kind==='arrival'&&row.state==='needs_attention'){
      const category=categorizeDriverGeofenceError(row.lastError);
      if(category)geofenceErrors[category]+=1;
    }
  }
  return {total:rows.length,byState,byKind,documentConflicts,
    uploadFailures:{total:uploadFailureTotal,affectedItems:uploadFailureItems,byKind:uploadFailuresByKind},geofenceErrors};
}

export function parseDriverBuildInfo(value:unknown):DriverBuildInfo|null{
  const source=object(value),version=text(source.version),buildHash=text(source.buildHash),builtAt=text(source.builtAt);
  if(!version||!buildHash||!/^[a-f0-9]{16,64}$/.test(buildHash)||!builtAt||!Number.isFinite(new Date(builtAt).getTime()))return null;
  return {version,buildHash,builtAt};
}

export async function readDriverBuildInfo(fetcher:typeof fetch=fetch):Promise<DriverBuildInfo|null>{
  try{
    const response=await fetcher('/driver-build.json',{cache:'no-store'});
    return response.ok?parseDriverBuildInfo(await response.json()):null;
  }catch{return null;}
}

const scopeKey=(tenantId:string,actorId:string)=>`${localPrefix}:${tenantId}:${actorId}`;
const lastSyncKey=(tenantId:string,actorId:string)=>`${scopeKey(tenantId,actorId)}:last-sync`;
const sharingKey=(tenantId:string,actorId:string)=>`${scopeKey(tenantId,actorId)}:sharing`;
const installationKey=`${localPrefix}:installation`;
const storage=():Storage|null=>typeof window==='undefined'?null:window.localStorage;

export function readDriverLastSuccessfulSync(tenantId:string,actorId:string,target=storage()):string|null{
  try{const value=target?.getItem(lastSyncKey(tenantId,actorId))??null;return value&&Number.isFinite(new Date(value).getTime())?value:null;}catch{return null;}
}
export function recordDriverSuccessfulSync(tenantId:string,actorId:string,at=new Date(),target=storage()):string{
  const value=at.toISOString();try{target?.setItem(lastSyncKey(tenantId,actorId),value);}catch{/* diagnostics never block operations */}return value;
}
export function isDriverDiagnosticsSharingEnabled(tenantId:string,actorId:string,target=storage()):boolean{
  try{return target?.getItem(sharingKey(tenantId,actorId))==='true';}catch{return false;}
}
export function setDriverDiagnosticsSharing(tenantId:string,actorId:string,enabled:boolean,target=storage()):void{
  try{target?.setItem(sharingKey(tenantId,actorId),String(enabled));}catch{/* diagnostics remain opt-in and best-effort */}
}
export function getDriverInstallationId(target=storage(),uuid:()=>string=()=>crypto.randomUUID()):string{
  try{
    const current=target?.getItem(installationKey);
    if(current&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current))return current;
    const created=uuid();target?.setItem(installationKey,created);return created;
  }catch{return uuid();}
}

export function createDriverAppHeartbeatPayload(input:{tenantId:string;installationId:string;build:DriverBuildInfo;
  lastSuccessfulSyncAt:string|null;summary:DriverOutboxSummary}):DriverAppHeartbeatPayload{
  return {version:1,tenant_id:input.tenantId,installation_id:input.installationId,app_version:input.build.version,
    build_hash:input.build.buildHash,last_successful_sync_at:input.lastSuccessfulSyncAt,
    outbox:{total:input.summary.total,by_state:input.summary.byState,by_kind:input.summary.byKind},
    document_conflicts:input.summary.documentConflicts,upload_failures:{total:input.summary.uploadFailures.total,
      affected_items:input.summary.uploadFailures.affectedItems,by_kind:input.summary.uploadFailures.byKind},
    geofence_errors:input.summary.geofenceErrors};
}

export function parseDriverAppObservability(value:unknown):DriverAppObservabilityReport{
  const root=object(value),serverErrors=object(root.geofence_errors);
  const devices=Array.isArray(root.devices)?root.devices.map(item=>{
    const source=object(item),outbox=object(source.outbox),states=object(outbox.by_state),kinds=object(outbox.by_kind),errors=object(source.geofence_errors);
    const failures=object(source.upload_failures),failureKinds=object(failures.by_kind);
    return {installationCode:text(source.installation_code)??'—',actorCode:text(source.actor_code)??'—',
      appVersion:text(source.app_version)??'—',buildHash:text(source.build_hash)??'—',lastSuccessfulSyncAt:text(source.last_successful_sync_at),
      outbox:{total:count(outbox.total),by_state:Object.fromEntries(DRIVER_OUTBOX_STATES.map(key=>[key,count(states[key])])) as Record<DriverOfflineState,number>,
        by_kind:Object.fromEntries(DRIVER_OUTBOX_KINDS.map(key=>[key,count(kinds[key])])) as Record<DriverOfflineKind,number>},
      documentConflicts:count(source.document_conflicts),
      uploadFailures:{total:count(failures.total),affected_items:count(failures.affected_items),
        by_kind:Object.fromEntries(DRIVER_OUTBOX_KINDS.map(key=>[key,count(failureKinds[key])])) as Record<DriverOfflineKind,number>},
      geofenceErrors:Object.fromEntries(DRIVER_GEOFENCE_ERROR_CATEGORIES.map(key=>[key,count(errors[key])])) as Record<DriverGeofenceErrorCategory,number>,
      seenAt:text(source.seen_at)??''};
  }).filter(item=>item.seenAt&&Number.isFinite(new Date(item.seenAt).getTime())):[];
  return {generatedAt:text(root.generated_at),totalDevices:count(root.total_devices),active24h:count(root.active_24h),
    geofenceErrors:{invalidPosition:count(serverErrors.invalid_position),trackerIdentity:count(serverErrors.tracker_identity),
      temporalBinding:count(serverErrors.temporal_binding),addressResolution:count(serverErrors.address_resolution),processing:count(serverErrors.processing)},devices};
}

export function heartbeatPayloadAsJson(payload:DriverAppHeartbeatPayload):Json{return payload as unknown as Json;}
