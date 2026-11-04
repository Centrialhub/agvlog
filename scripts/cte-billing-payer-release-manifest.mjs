import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const payerMigration='20261104194722_resolve_cte_billing_payer.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyCteBillingPayerRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/cte-billing-payer-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-cte-billing-payer-only'
  ||m.filename!==payerMigration||!forwardFiles.includes(payerMigration)
  ||!entries.find(e=>e.name===payerMigration)?.isFile())throw new Error('CT-e payer release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',payerMigration));
 const previous=(await readFile(resolve(root,'docs/qa/cte-subcontracting-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedSubcontractingManifestSha256)
  throw new Error('CT-e payer release bytes changed');
 return {filename:payerMigration,sha256:m.sha256};
}
