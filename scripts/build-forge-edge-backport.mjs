import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildSync,version} from 'esbuild';

const root=process.cwd(),vendor='supabase/functions/_shared/vendor/forge';
const source=JSON.parse(fs.readFileSync(path.join(root,'vendor/node-forge-1.4.1-agvlog.2.provenance.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [file,digest] of Object.entries(source.fileHashes)){
 if(hash(fs.readFileSync(path.join(root,vendor,file)))!==digest)throw Error('Unverified Forge source: '+file);
}
const options={absWorkingDir:root,entryPoints:[vendor+'/lib/index.js'],bundle:true,format:'esm',platform:'browser',
 target:'es2022',external:['crypto'],define:{process:'undefined'},write:false,metafile:true,
 banner:{js:'/* AGVLOG local security backport; not an upstream release.\n'+fs.readFileSync(path.join(root,vendor,'LICENSE'),'utf8')+'\n*/'}};
const result=buildSync(options),bytes=result.outputFiles[0].contents;
const provenance={formatVersion:1,upstreamReleaseClaim:false,sourceTarballSha256:source.sha256,esbuildVersion:version,
 options:{format:options.format,platform:options.platform,target:options.target,external:options.external,define:options.define},
 artifact:vendor+'/edge.mjs',sha256:hash(bytes),inputs:Object.keys(result.metafile.inputs).sort()};
function preserve(file,content){const target=path.join(root,file);if(fs.existsSync(target)&&!fs.readFileSync(target).equals(Buffer.from(content)))throw Error('Existing build differs; preserve and review before replacement: '+file);fs.writeFileSync(target,content);}
preserve(provenance.artifact,bytes);
preserve('vendor/node-forge-edge-esm.provenance.json',JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({artifact:provenance.artifact,sha256:provenance.sha256,esbuildVersion:version,sourceFiles:provenance.inputs.length}));
