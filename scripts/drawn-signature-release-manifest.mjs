import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const drawnSignatureMigration='20261114110409_driver_optional_drawn_signature.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyDrawnSignatureRelease({root,forwardFiles,entries}){
 let text;try{text=await readFile(resolve(root,'docs/qa/drawn-signature-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-optional-drawn-signature-only'
  ||m.filename!==drawnSignatureMigration||!forwardFiles.includes(drawnSignatureMigration)
  ||!entries.find(e=>e.name===drawnSignatureMigration)?.isFile())throw Error('Drawn signature release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',drawnSignatureMigration));
 const previous=(await readFile(resolve(root,'docs/qa/quick-cargo-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedQuickCargoManifestSha256)
  throw Error('Drawn signature release bytes changed');
 return {filename:drawnSignatureMigration,sha256:m.sha256};
}
