import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const loadNoteCheckMigration='20261116154757_load_note_pre_dispatch_checks.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyLoadNoteCheckRelease({root,forwardFiles,entries}){
 let text;try{text=await readFile(resolve(root,'docs/qa/load-note-check-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-load-note-pre-dispatch-check-only'
  ||m.filename!==loadNoteCheckMigration||!forwardFiles.includes(loadNoteCheckMigration)
  ||!entries.find(e=>e.name===loadNoteCheckMigration)?.isFile())throw Error('Load note check release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',loadNoteCheckMigration));
 const previous=(await readFile(resolve(root,'docs/qa/drawn-signature-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedDrawnSignatureManifestSha256)
  throw Error('Load note check release bytes changed');
 return {filename:loadNoteCheckMigration,sha256:m.sha256};
}
