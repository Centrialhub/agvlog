export interface PwaAssetChunk {
 fileName:string;isEntry:boolean;moduleIds:readonly string[];imports:readonly string[];dynamicImports:readonly string[];
}
export function isDriverOrAuthModule(id:string){
 const path=id.split(String.fromCharCode(92)).join('/');
 return path.includes('/pages/driver/')||path.includes('/components/driver/')||path.endsWith('/components/layout/DriverLayout.tsx')||path.endsWith('/pages/Auth.tsx');
}
interface ModuleImports {importedIds:readonly string[];dynamicallyImportedIds:readonly string[]}
/** Discover source lazy entries; emitted chunk imports supply used static deps. */
export function driverDependencyModules(roots:readonly string[],lookup:(id:string)=>ModuleImports|null|undefined){
 const seen=new Set<string>(),entries=new Set(roots);
 const visit=(id:string)=>{if(seen.has(id))return;seen.add(id);const info=lookup(id);info?.importedIds.forEach(visit);
  const path=id.split(String.fromCharCode(92)).join('/');
  // Global route registries enumerate other roles; driver routes are own roots.
  if(!path.endsWith('/app/AppRoutes.tsx')&&!path.endsWith('/app/routeGuards.tsx'))info?.dynamicallyImportedIds.forEach(target=>{entries.add(target);visit(target);});};
 roots.forEach(visit);return [...entries];
}
/** Select mandatory deferred bootstrap imports and resolved driver/auth modules. */
export function driverShellAssetFiles(chunks:readonly PwaAssetChunk[],css:readonly string[],driverDependencyFiles:readonly string[]=[]):string[]{
 const byFile=new Map(chunks.map(chunk=>[chunk.fileName,chunk])),selected=new Set<string>();
 const include=(file:string)=>{if(selected.has(file)||!byFile.has(file))return;selected.add(file);byFile.get(file)!.imports.forEach(include);};
 for(const chunk of chunks){
  if(chunk.isEntry){include(chunk.fileName);chunk.dynamicImports.forEach(include);}
  if(chunk.moduleIds.some(isDriverOrAuthModule))include(chunk.fileName);
 }
 driverDependencyFiles.forEach(include);css.forEach(file=>selected.add(file));return [...selected].sort();
}
