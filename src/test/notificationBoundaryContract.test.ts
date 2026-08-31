import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import ts from 'typescript';
function files(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?(entry.name==='test'?[]:files(join(directory,entry.name))):/\.tsx?$/.test(entry.name)?[join(directory,entry.name)]:[]);}
const imports=files('src').flatMap(file=>{
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 return source.statements.filter(ts.isImportDeclaration).flatMap(node=>{
  if(!ts.isStringLiteral(node.moduleSpecifier)||!node.importClause?.namedBindings||!ts.isNamedImports(node.importClause.namedBindings))return [];
  const module=node.moduleSpecifier.text;
  return node.importClause.namedBindings.elements.map(item=>({file:file.replace(/\\/g,'/'),module,name:item.propertyName?.text??item.name.text}));
 });
});
describe('notification access boundary in production imports',()=>{
 it('does not permit consumer imports of unscoped toast APIs',()=>{
  const unscoped=imports.filter(item=>item.name==='toast'&&(['@/hooks/use-toast','@/components/ui/use-toast','@/components/ui/sonner'].includes(item.module)||(item.module==='sonner'&&item.file!=='src/hooks/useSonnerToast.ts')));
  expect(unscoped).toEqual([]);
 });
 it('uses scoped confirmation hooks, not module-level confirmation functions',()=>{
  expect(imports.filter(item=>item.module==='@/hooks/useAlertStore'&&['confirmAction','promptAction'].includes(item.name))).toEqual([]);
 });
});
