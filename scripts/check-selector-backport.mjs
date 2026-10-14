import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=process.cwd(),identity=JSON.parse(fs.readFileSync(path.join(root,'vendor/postcss-selector-parser-6.1.4-agvlog.provenance.json'),'utf8'));
const digest=(bytes,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(bytes).digest(encoding);
if(identity.tarball!=='vendor/postcss-selector-parser-6.1.4-agvlog.tgz'||identity.sha256!=='443d5e49316ae4475d726f146a3798eb8ef810377bff7fe8998f7fba040f1e43'||identity.integrity!=='sha512-ZcACqiOJABuTjRzI1DwEtpMMHkbICokllhGxMqfJLq9LYKfpAy0TG51WC2aEZIQWvvXQ1Vx2WR38PPO5VC959g=='||identity.patchedDistParserSha256!=='ffc898cffcf7b654e4af1d5245c33890f7d9600809de790fd385483ee49c1c68')throw Error('Selector approved metadata identity mismatch');
const bytes=fs.readFileSync(path.join(root,'vendor/postcss-selector-parser-6.1.4-agvlog.tgz'));
if(identity.tarball!=='vendor/postcss-selector-parser-6.1.4-agvlog.tgz'||identity.sha256!=='443d5e49316ae4475d726f146a3798eb8ef810377bff7fe8998f7fba040f1e43'||digest(bytes)!==identity.sha256||'sha512-'+digest(bytes,'sha512','base64')!==identity.integrity)throw Error('Selector approved tarball identity mismatch');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.devDependencies['postcss-selector-parser']!=='file:'+identity.tarball||pkg.overrides['postcss-selector-parser']!=='$postcss-selector-parser')throw Error('Selector deterministic override mismatch');
const locked=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const entries=Object.entries(locked.packages).filter(([key])=>key.endsWith('/postcss-selector-parser'));
if(!entries.length||entries.some(([,value])=>value.version!=='6.1.4'||value.integrity!==identity.integrity||value.resolved!=='file:'+identity.tarball))throw Error('Selector lock identity mismatch');
const require=createRequire(path.join(root,'package.json')),copies=[];
for(const consumer of identity.consumerResolution){const consumerRoot=path.dirname(require.resolve(consumer+'/package.json')),resolve=createRequire(path.join(consumerRoot,'package.json'));const entry=resolve.resolve('postcss-selector-parser/package.json'),directory=path.dirname(entry),metadata=JSON.parse(fs.readFileSync(entry,'utf8')),parser=fs.readFileSync(path.join(directory,'dist/parser.js'));if(metadata.version!=='6.1.4'||metadata.license!=='MIT'||digest(parser)!==identity.patchedDistParserSha256)throw Error('Selector consumer installed bytes mismatch:'+consumer);copies.push({consumer,directory,version:metadata.version,parserSha256:digest(parser)});}
console.log(JSON.stringify({approvedTarball:identity.sha256,integrity:identity.integrity,consumers:copies,physicalCopies:new Set(copies.map(x=>x.directory)).size,upstreamReleaseClaim:false,auditCleanClaim:false}));
