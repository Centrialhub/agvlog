import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const filename='20261127210105_driver_arrival_unmapped_destination.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyDriverArrivalUnmappedRelease({root,forwardFiles,entries}){
 let text;try{text=await readFile(resolve(root,'docs/qa/driver-arrival-unmapped-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-driver-arrival-unmapped-only'
  ||m.filename!==filename||!forwardFiles.includes(filename)||!entries.find(e=>e.name===filename)?.isFile())
  throw Error('Driver arrival unmapped release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',filename));
 const previous=(await readFile(resolve(root,'docs/qa/operational-load-archive-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedOperationalLoadArchiveManifestSha256)
  throw Error('Driver arrival unmapped release bytes changed');
 return {filename,sha256:m.sha256};
}
