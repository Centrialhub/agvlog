import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const knownHooks = ['useFinanceLedger','useBankReconciliation','useBilling','useClientInvoiceLifecycle','useClosingLifecycle','useDriverSettlements','useExpenseCreation','useExpenseReview','useFinancialPayments','usePayables','usePayroll','useReceivableFinancial','useReceivables','useReceivablePortfolio','useFiscalDashboardSummary','useRecordedCostSummary','useReceivableUnloadingOrigin'];
const unwrap = n => n && (ts.isParenthesizedExpression(n)||ts.isAsExpression(n)||ts.isTypeAssertionExpression(n)||ts.isNonNullExpression(n)||ts.isSatisfiesExpression(n)) ? unwrap(n.expression) : n;
const walk = (n,visit) => {visit(n);ts.forEachChild(n,c=>walk(c,visit));};
const literal = n => n && (ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
export function analyzeSource(text, filename='fixture.ts') {
 const options={noResolve:true,noLib:true,target:ts.ScriptTarget.Latest,jsx:ts.JsxEmit.ReactJSX};
 const source=ts.createSourceFile(filename,text,options.target,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const host=ts.createCompilerHost(options);host.getSourceFile=p=>p===filename?source:undefined;host.fileExists=p=>p===filename;host.readFile=p=>p===filename?text:undefined;
 const checker=ts.createProgram([filename],options,host).getTypeChecker();
 const declaration = n => checker.getSymbolAtLocation(n)?.declarations??[];
 function importedClient(n){return ts.isIdentifier(n)&&declaration(n).some(d=>ts.isImportSpecifier(d)&&(d.propertyName??d.name).text==='supabase'&&ts.isImportDeclaration(d.parent.parent.parent)&&/integrations\/supabase\/client$/.test(d.parent.parent.parent.moduleSpecifier.text));}
 function transport(n){n=unwrap(n);return !!n&&ts.isPropertyAccessExpression(n)&&n.name.text==='rpc'&&importedClient(unwrap(n.expression));}
 const adapters=new Set();
 walk(source,n=>{if(ts.isFunctionDeclaration(n)&&n.name&&n.body){let found=false;walk(n.body,c=>{if(ts.isCallExpression(c)&&transport(c.expression))found=true;});if(found)adapters.add(n);}
 if(ts.isVariableDeclaration(n)&&n.initializer&&transport(n.initializer))adapters.add(n);});
 const calls=[];
 walk(source,n=>{
  if(!ts.isCallExpression(n))return;
  const target=unwrap(n.expression);
  const viaAdapter=ts.isIdentifier(target)&&declaration(target).some(d=>adapters.has(d));
  if(!transport(target)&&!viaAdapter)return;
  const name=literal(unwrap(n.arguments[0]));let argument_names=[],arguments_complete=true;
  const args=unwrap(n.arguments[1]);
  if(args&&!ts.isObjectLiteralExpression(args))arguments_complete=false;
  if(args&&ts.isObjectLiteralExpression(args))for(const p of args.properties){
   if(ts.isSpreadAssignment(p)){arguments_complete=false;continue;}
   let key=ts.isComputedPropertyName(p.name)?literal(unwrap(p.name.expression)):ts.isIdentifier(p.name)?p.name.text:literal(p.name);
   if(key===null)arguments_complete=false;else argument_names.push(key);
  }
  const at=source.getLineAndCharacterOfPosition(n.getStart(source));
  calls.push({file:filename,line:at.line+1,column:at.character+1,name,argument_names:[...new Set(argument_names)].sort(),arguments_complete,resolution:name===null?'dynamic_name':arguments_complete?'literal_named_arguments':'dynamic_arguments',via:viaAdapter?'local_adapter':'supabase.rpc'});
 });
 return calls;
}
export function buildCatalogSql(calls){
 const rows=calls.filter(c=>c.name!==null).map((c,i)=>({call_id:i+1,...c}));
 const json=JSON.stringify(rows).replace(/'/g,"''");
 return `-- SELECT only. Structural RPC compatibility, NOT activation, semantic proof or type validation.\nwith expected as (select * from jsonb_to_recordset('${json}'::jsonb) as x(call_id int,file text,line int,name text,argument_names text[],arguments_complete boolean)),\n candidates as (select e.*,p.oid,p.provariadic,p.pronargs,p.pronargdefaults,p.oid::regprocedure::text signature,\n array(select p.proargnames[a.n] from generate_series(1,coalesce(array_length(p.proallargtypes,1),p.pronargs)) a(n) where p.proargmodes is null or p.proargmodes[a.n] in ('i','b','v') order by a.n) input_names\n from expected e left join pg_namespace ns on ns.nspname='public' left join pg_proc p on p.pronamespace=ns.oid and p.proname=e.name and p.prokind='f'),\n checked as (select *,case when oid is null then false when not arguments_complete then null when provariadic<>0 or array_position(input_names,null) is not null then null else argument_names <@ input_names and input_names[1:pronargs-pronargdefaults] <@ argument_names end as names_compatible from candidates)\n select call_id,file,line,name,argument_names,arguments_complete,count(oid) overload_count,count(*) filter(where names_compatible) named_compatible_overloads,\n case when count(oid)=0 then 'missing' when not arguments_complete then 'unresolved_arguments' when bool_or(names_compatible is null) then 'unresolved_signature' when count(*) filter(where names_compatible)=0 then 'argument_mismatch' when count(*) filter(where names_compatible)>1 then 'ambiguous' else 'named_candidate_only' end diagnostic,\n coalesce(jsonb_agg(jsonb_build_object('signature',signature,'input_names',input_names,'required_count',pronargs-pronargdefaults,'default_count',pronargdefaults,'names_compatible',names_compatible,'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',oid,'EXECUTE'),'authenticated_schema_usage',has_schema_privilege('authenticated','public','USAGE'))) filter(where oid is not null),'[]'::jsonb) candidates\n from checked group by call_id,file,line,name,argument_names,arguments_complete order by call_id;\n`;
}
function walkFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walkFiles(path.join(dir,e.name)):[path.join(dir,e.name)]);}
export function generate(root=process.cwd()){
 const files=walkFiles(path.join(root,'src/lib/financial')).filter(p=>/\.tsx?$/.test(p));
 for(const h of knownHooks)for(const ext of ['ts','tsx']){const p=path.join(root,'src/hooks',`${h}.${ext}`);if(fs.existsSync(p))files.push(p);}
 const calls=files.sort().flatMap(p=>analyzeSource(fs.readFileSync(p,'utf8'),path.relative(root,p).replaceAll('\\','/')));
 const manifest={version:1,generated_at:new Date().toISOString(),scope:{directory:'src/lib/financial',known_hooks:knownHooks},files:files.map(p=>path.relative(root,p).replaceAll('\\','/')),calls,unresolved:calls.filter(c=>c.resolution!=='literal_named_arguments'),limits:['Supabase imported client and local direct wrappers/aliases only; arbitrary intermodule wrappers and chained schema clients are not resolved.','Argument value types/undefined omission, PostgreSQL semantic behavior, RLS, execution and activation are not certified.','Dynamic calls are unresolved; SQL excludes dynamic names and marks dynamic argument objects.','All literal RPC names in the scoped financial files are included, including legacy names without finance prefix.']};
 const base=path.join(root,'docs/qa/finance-rpc-readiness-current');fs.writeFileSync(base+'.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(base+'.sql',buildCatalogSql(calls));
 return {files:files.length,calls:calls.length,names:new Set(calls.filter(c=>c.name).map(c=>c.name)).size,unresolved:manifest.unresolved.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))console.log(JSON.stringify(generate(),null,2));
