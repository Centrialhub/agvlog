import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const quickCargoMigration='20261113165544_driver_quick_cargo_confirmation.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyQuickCargoRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/quick-cargo-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-quick-cargo-only'
  ||m.filename!==quickCargoMigration||!forwardFiles.includes(quickCargoMigration)
  ||!entries.find(e=>e.name===quickCargoMigration)?.isFile())throw new Error('Quick cargo release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',quickCargoMigration));
 const previous=(await readFile(resolve(root,'docs/qa/driver-readiness-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedReadinessManifestSha256)
  throw new Error('Quick cargo release bytes changed');
 return {filename:quickCargoMigration,sha256:m.sha256};
}
