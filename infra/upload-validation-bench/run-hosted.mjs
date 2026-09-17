import {execSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const secret=randomBytes(32).toString('hex');
execSync('npx supabase secrets set FINANCE_IMAGE_BENCH_TOKEN='+secret+' --project-ref qcvnsdrbcchaxvawcngk',{stdio:['ignore','pipe','ignore']});
const url='https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/finance-image-runtime-benchmark';
const manifest=JSON.parse(readFileSync('infra/upload-validation-bench/fixtures/manifest.json','utf8'));
const results=[];
try {
const denied=await fetch(url,{method:'POST'});results.push({case:'anonymous_denied',status:denied.status});console.log(JSON.stringify(results[0]));
for(const fixture of manifest.records){const bytes=readFileSync('infra/upload-validation-bench/fixtures/'+fixture.name);const form=new FormData();form.set('file',new Blob([bytes]),fixture.name);let row;try{const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret},body:form,signal:AbortSignal.timeout(35000)});const body=await response.json();row={fixture:fixture.name,expected:fixture.expected,status:response.status,body};}catch{row={fixture:fixture.name,error:'request_failed_or_timed_out'};}results.push(row);writeFileSync('docs/qa/finance-image-hosted-benchmark-2026-09-11.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(row));}

} finally { execSync('npx supabase secrets unset FINANCE_IMAGE_BENCH_TOKEN --project-ref qcvnsdrbcchaxvawcngk --yes',{stdio:['ignore','pipe','ignore']}); }
