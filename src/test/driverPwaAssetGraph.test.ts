import {describe,expect,it} from 'vitest';
import {driverShellAssetFiles,driverDependencyModules,type PwaAssetChunk} from '../../scripts/lib/pwaAssetGraph';
const chunk=(fileName:string,options:Partial<PwaAssetChunk>={}):PwaAssetChunk=>({fileName,isEntry:false,moduleIds:[],imports:[],dynamicImports:[],...options});
describe('cold driver PWA build asset graph',()=>{
 it('includes every mandatory deferred entry bootstrap import and static dependencies',()=>{
  const graph=[chunk('index.js',{isEntry:true,imports:['react.js'],dynamicImports:['App.js','Boundary.js','errorTelemetry.js','performance.js']}),chunk('App.js',{imports:['sdk.js'],dynamicImports:['admin.js']}),chunk('Boundary.js'),chunk('errorTelemetry.js',{imports:['sdk.js']}),chunk('performance.js'),chunk('react.js'),chunk('sdk.js'),chunk('admin.js')];
  expect(driverShellAssetFiles(graph,['app.css'])).toEqual(['App.js','Boundary.js','app.css','errorTelemetry.js','index.js','performance.js','react.js','sdk.js']);
 });
 it('includes unvisited driver/auth lazy branches, without collecting all application lazy routes',()=>{
  const graph=[chunk('App.js',{dynamicImports:['admin.js']}),chunk('driver.js',{moduleIds:['C:/app/src/pages/driver/Expenses.tsx'],imports:['App.js'],dynamicImports:['receiptDialog.js']}),chunk('receiptDialog.js',{imports:['pdf.js'],dynamicImports:['nestedProof.js']}),chunk('nestedProof.js'),chunk('pdf.js'),chunk('auth.js',{moduleIds:['C:/app/src/pages/Auth.tsx'],dynamicImports:['authHelp.js']}),chunk('authHelp.js'),chunk('admin.js')];
  expect(driverShellAssetFiles(graph,[],['receiptDialog.js','nestedProof.js','authHelp.js'])).toEqual(['App.js','auth.js','authHelp.js','driver.js','nestedProof.js','pdf.js','receiptDialog.js']);
 });
 it('handles cycles and already selected lazy roots independently of ordering',()=>{
  const graph=[chunk('entry.js',{isEntry:true,dynamicImports:['driver.js']}),chunk('driver.js',{moduleIds:['/src/components/driver/Proof.tsx'],imports:['shared.js'],dynamicImports:['dialog.js']}),chunk('shared.js',{imports:['driver.js']}),chunk('dialog.js',{dynamicImports:['driver.js']})];
  const result=['dialog.js','driver.js','entry.js','shared.js'];expect(driverShellAssetFiles(graph,[],['dialog.js'])).toEqual(result);expect(driverShellAssetFiles([...graph].reverse(),[],['dialog.js'])).toEqual(result);
 });
 it('normalizes Windows roots, retains CSS and ignores external chunk references',()=>{
  const graph=[chunk('driver.js',{moduleIds:[['C:','app','src','components','layout','DriverLayout.tsx'].join(String.fromCharCode(92))],imports:['external-url']}),chunk('auth.js',{moduleIds:[['C:','app','src','pages','Auth.tsx'].join(String.fromCharCode(92))]})];expect(driverShellAssetFiles(graph,['styles.css'])).toEqual(['auth.js','driver.js','styles.css']);
 });
 it('follows source dynamic branches instead of all routes in a shared App chunk',()=>{
  const modules:Record<string,{importedIds:string[];dynamicallyImportedIds:string[]}>= {'driver':{importedIds:['tenant'],dynamicallyImportedIds:['receipt']},'tenant':{importedIds:['sdk'],dynamicallyImportedIds:[]},'receipt':{importedIds:['tenant'],dynamicallyImportedIds:['proof']},'proof':{importedIds:[],dynamicallyImportedIds:[]},'App':{importedIds:['tenant'],dynamicallyImportedIds:['admin']}};
  expect(driverDependencyModules(['driver'],id=>modules[id])).toEqual(['driver','receipt','proof']);
 });

 it('does not expand global route registries reached through a shared navigation helper',()=>{
  const registry='/src/app/AppRoutes.tsx',guard='/src/app/routeGuards.tsx';
  const modules:Record<string,{importedIds:string[];dynamicallyImportedIds:string[]}>= {'driver':{importedIds:[registry],dynamicallyImportedIds:['receipt']},[registry]:{importedIds:[guard,'sdk'],dynamicallyImportedIds:['adminRoute']},[guard]:{importedIds:[],dynamicallyImportedIds:['internalDefault']},'receipt':{importedIds:[],dynamicallyImportedIds:[]}};
  expect(driverDependencyModules(['driver'],id=>modules[id])).toEqual(['driver','receipt']);
 });

});
