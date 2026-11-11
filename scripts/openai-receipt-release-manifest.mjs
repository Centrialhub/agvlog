import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const openaiReceiptMigration='20261111182259_support_openai_receipt_recognition.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyOpenaiReceiptRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/openai-receipt-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-openai-receipt-only'
  ||m.filename!==openaiReceiptMigration||!forwardFiles.includes(openaiReceiptMigration)
  ||!entries.find(e=>e.name===openaiReceiptMigration)?.isFile())throw new Error('OpenAI receipt release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',openaiReceiptMigration));
 const previous=(await readFile(resolve(root,'docs/qa/operations-read-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedOperationsManifestSha256)
  throw new Error('OpenAI receipt release bytes changed');
 return {filename:openaiReceiptMigration,sha256:m.sha256};
}
