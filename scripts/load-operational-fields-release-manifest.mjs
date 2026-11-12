import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const loadOperationalFieldsMigration='20261112190322_editable_load_operational_fields.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyLoadOperationalFieldsRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/load-operational-fields-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-load-operational-fields-only'
  ||m.filename!==loadOperationalFieldsMigration||!forwardFiles.includes(loadOperationalFieldsMigration)
  ||!entries.find(e=>e.name===loadOperationalFieldsMigration)?.isFile())throw new Error('Operational fields release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',loadOperationalFieldsMigration));
 const previous=(await readFile(resolve(root,'docs/qa/openai-receipt-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedOpenaiManifestSha256)
  throw new Error('Operational fields release bytes changed');
 return {filename:loadOperationalFieldsMigration,sha256:m.sha256};
}
