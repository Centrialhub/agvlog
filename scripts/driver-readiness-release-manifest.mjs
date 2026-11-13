import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const driverReadinessMigration='20261113145153_driver_vehicle_readiness_checklist.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyDriverReadinessRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/driver-readiness-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-driver-readiness-only'
  ||m.filename!==driverReadinessMigration||!forwardFiles.includes(driverReadinessMigration)
  ||!entries.find(e=>e.name===driverReadinessMigration)?.isFile())throw new Error('Driver readiness release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',driverReadinessMigration));
 const previous=(await readFile(resolve(root,'docs/qa/load-operational-fields-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedLoadFieldsManifestSha256)
  throw new Error('Driver readiness release bytes changed');
 return {filename:driverReadinessMigration,sha256:m.sha256};
}
