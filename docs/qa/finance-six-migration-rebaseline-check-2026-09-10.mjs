import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const wanted=['124716','125034','125357','130032','130956','132406'];
const old=['125034-132406','034731-124716'].flatMap(x=>JSON.parse(readFileSync('docs/qa/finance-production-block-'+x+'-hashes-2026-09-10.json','utf8').replace(/^\uFEFF/,'')));
const result=old.filter(x=>wanted.includes(x.file.slice(8,14))).map(row=>{
 const bytes=readFileSync('supabase/migrations/'+row.file), s=bytes.toString('utf8').replace(/\r\n/g,'\n').replace(/[\r\n]+$/,'');
 const hits=[];
 for(const eol of ['\n','\r\n'])for(let n=0;n<=12;n++)if(sha(s.replace(/\n/g,eol)+eol.repeat(n))===row.sha256)hits.push({eol_bytes:eol.length,trailing_newlines:n});
 return {file:row.file,current_sha256:sha(bytes),previous_sha256:row.sha256,exact_previous_hash_reconstructed:hits};
});
writeFileSync('docs/qa/finance-six-migration-rebaseline-hashes-2026-09-10.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
