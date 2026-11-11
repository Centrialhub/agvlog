import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const operationsReadMigration='20261111154053_restore_operations_read_contracts.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyOperationsReadRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/operations-read-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-operations-read-only'
  ||m.filename!==operationsReadMigration||!forwardFiles.includes(operationsReadMigration)
  ||!entries.find(e=>e.name===operationsReadMigration)?.isFile())throw new Error('Operations read release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',operationsReadMigration));
 const previous=(await readFile(resolve(root,'docs/qa/receipt-ocr-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedReceiptManifestSha256)
  throw new Error('Operations read release bytes changed');
 return {filename:operationsReadMigration,sha256:m.sha256};
}
