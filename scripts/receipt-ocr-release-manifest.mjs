import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const receiptOcrMigration='20261110151444_enable_receipt_handwriting_recognition.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyReceiptOcrRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/receipt-ocr-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-receipt-ocr-only'
  ||m.filename!==receiptOcrMigration||!forwardFiles.includes(receiptOcrMigration)
  ||!entries.find(e=>e.name===receiptOcrMigration)?.isFile())throw new Error('Receipt OCR release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',receiptOcrMigration));
 const previous=(await readFile(resolve(root,'docs/qa/cte-billing-payer-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedPayerManifestSha256)
  throw new Error('Receipt OCR release bytes changed');
 return {filename:receiptOcrMigration,sha256:m.sha256};
}
