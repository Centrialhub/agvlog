import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('supabase/functions'),name=process.argv[2];
if(!['secure-upload','finance-statement-verify','finance-image-runtime-benchmark'].includes(name))throw new Error('Specify reviewed function');
const queue=[`${name}/index.ts`,`${name}/deno.json`],seen=new Set(),files=[];
const config=JSON.parse(readFileSync(resolve(root,name,'deno.json'),'utf8'));
for(const value of Object.values(config.imports??{}))if(value.startsWith('.'))queue.push(`${name}/${value.replace(/^\.\//,'')}`);
while(queue.length){
 const path=queue.shift();if(seen.has(path))continue;seen.add(path);
 const full=resolve(root,path);if(!full.startsWith(root+sep))throw new Error('Dependency escapes functions root');
 const content=readFileSync(full,'utf8');files.push({name:path,content});
 if(path.endsWith('.ts'))for(const match of content.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+\.(?:ts|mjs))['"]/g))queue.push(relative(root,resolve(dirname(full),match[1])).split(sep).join('/'));
}
const output=`docs/qa/${name}-deploy-files-2026-09-11.json`;
const bytes=JSON.stringify({name,entrypoint_path:`${name}/index.ts`,import_map_path:`${name}/deno.json`,verify_jwt:name!=='finance-image-runtime-benchmark',files});writeFileSync(output,bytes);
console.log(JSON.stringify({output,count:files.length,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex'),files:files.map(f=>f.name)},null,2));