import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import createDOMPurify from 'dompurify';
import {expect,it} from 'vitest';

const require=createRequire(import.meta.url);
const expansions=[
 'node_modules/brace-expansion',
 'node_modules/glob/node_modules/brace-expansion',
 'node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion',
].map(path=>({path,expand:require(resolve(path)) as (input:string)=>string[]}));

it.each(expansions)('bounds deeply nested input in $path without stack exhaustion',({expand})=>{
 const nested='{'.repeat(4000)+'a,b'+'}'.repeat(4000);
 expect(()=>expand(nested)).not.toThrow();
});

it('preserves ordinary choice and range expansion used by the build tools',()=>{
 for(const {expand} of expansions){
  expect(expand('src/{billing,financial}/file{1..3}.tsx')).toEqual([
   'src/billing/file1.tsx','src/billing/file2.tsx','src/billing/file3.tsx',
   'src/financial/file1.tsx','src/financial/file2.tsx','src/financial/file3.tsx',
  ]);
 }
});

it.each(['afterSanitizeElements','afterSanitizeAttributes'] as const)('neutralizes a detached subtree after %s',hook=>{
 const root=window.document.createElement('div');
 try{
  const purifier=createDOMPurify(window);
  root.innerHTML='<section id="wrap"><img src="x" onerror="ATTACKER()"></section>';
  window.document.body.appendChild(root);
  const image=root.querySelector('img')!;
  const detachWrapper=(node:Node)=>{if(node instanceof window.Element&&node.id==='wrap')node.remove();};
  if(hook==='afterSanitizeElements')purifier.addHook('afterSanitizeElements',detachWrapper);
  else purifier.addHook('afterSanitizeAttributes',detachWrapper);
  purifier.sanitize(root,{IN_PLACE:true});
  expect(root.contains(image)).toBe(false);
  expect(image.hasAttribute('onerror')).toBe(false);
 }finally{root.remove();}
});

it('preserves formatted PDF input while stripping scripts and event attributes',()=>{
 const sanitized=createDOMPurify(window).sanitize('<p><b>Recibo</b><img src="x" onerror="ATTACKER()"></p><script>ATTACKER()</script>');
 expect(sanitized).toContain('<b>Recibo</b>');
 expect(sanitized).not.toMatch(/onerror|<script|ATTACKER/);
});
