import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const pins=[
 {name:'node-forge',version:'1.4.1-agvlog.2',sha256:'a030ce10115256d5f924866d9cb5aa4dbc8dc3fdf8d7e8574f8520b63d2c4a8a',provenance:'e5864ac178d3355174f94ba8b6e912b627a31204dd9d46c70faaa6171e2b0504'},
 {name:'braces',version:'3.0.4-agvlog.1',sha256:'8bc64fccfbfc53afd515628e63ed56a663033fc73765aa27eb371098b63ae094',provenance:'104b3590257671ca9ce87e0f3a541c2c2dd7fe5ec1ada39a9bf214cdb8f7637a'},
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(root,file)=>fs.readFileSync(path.join(root,file));
const json=(root,file)=>JSON.parse(read(root,file));
const verify=(root,file,expected)=>{if(hash(read(root,file))!==expected)throw Error('Security backport bytes mismatch: '+file);};
function inventory(root,directory,expected){
 const found=[];
 function walk(relative){for(const entry of fs.readdirSync(path.join(root,directory,relative),{withFileTypes:true})){
  const file=relative?relative+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())throw Error('Unexpected security package symlink');
  if(entry.isDirectory())walk(file);else found.push(file);
 }}
 walk('');
 if(JSON.stringify(found.sort())!==JSON.stringify([...expected].sort()))throw Error('Unexpected security package inventory: '+directory);
}

export function verifySecurityBackports(root=process.cwd()){
 const pkg=json(root,'package.json'),lock=json(root,'package-lock.json');
 for(const p of pins){
  const base=`vendor/${p.name}-${p.version}`,spec=`file:${base}.tgz`;
  verify(root,base+'.provenance.json',p.provenance);verify(root,base+'.tgz',p.sha256);
  const provenance=json(root,base+'.provenance.json');
  if(provenance.officialUpstreamRelease!==false||provenance.localVersion!==p.version||provenance.sha256!==p.sha256
   ||pkg.devDependencies[p.name]!==spec)throw Error('Security backport identity mismatch: '+p.name);
  const key='node_modules/'+p.name,entries=Object.entries(lock.packages).filter(([k])=>k===key||k.endsWith('/'+key));
  if(entries.length!==1||entries[0][1].version!==p.version||entries[0][1].resolved!==spec
   ||entries[0][1].integrity!==provenance.integrity)throw Error('Security backport lock mismatch: '+p.name);
  for(const [file,digest] of Object.entries(provenance.fileHashes)){
   verify(root,key+'/'+file,digest);
   if(p.name==='node-forge')verify(root,'supabase/functions/_shared/vendor/forge/'+file,digest);
  }
  inventory(root,key,Object.keys(provenance.fileHashes));
  if(p.name==='node-forge')inventory(root,'supabase/functions/_shared/vendor/forge',[...Object.keys(provenance.fileHashes),'edge.mjs']);
 }
 if(pkg.overrides.braces!=='$braces')throw Error('Braces override must use the exact root artifact');
 const require=createRequire(path.join(root,'package.json'));
 for(const consumer of ['chokidar','micromatch']){
  const resolver=createRequire(require.resolve(consumer+'/package.json'));
  if(fs.realpathSync(resolver.resolve('braces/package.json'))!==fs.realpathSync(path.join(root,'node_modules/braces/package.json')))
   throw Error('Consumer resolved an unpatched braces: '+consumer);
 }
 const deno=json(root,'supabase/functions/fiscal-certificate-manage/deno.json');
 verify(root,'vendor/node-forge-edge-esm.provenance.json','560f50d9f9ee1c52a392397990f78bbb6bf954b9bd43dc9d243063c0e5d1972b');
 verify(root,'supabase/functions/_shared/vendor/forge/edge.mjs','0d168cb2a9b03b7450b5234177247877e0e448baa6d51acb0c26c172abd303ac');
 if(deno.imports['node-forge']!=='../_shared/vendor/forge/edge.mjs')throw Error('Fiscal Edge must resolve the verified local Forge');
 return {patchedPackages:pins.map(p=>p.name+'@'+p.version),upstreamReleaseClaim:false,installedAndEdgeBytesVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifySecurityBackports()));
