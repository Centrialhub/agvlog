export const IMAGE_RUNTIME={bucket:'upload-validation-runtime',path:'magick-wasm/0.0.43/x86/5a4ed1017eda113144c86ae839c22c610afebcfebfa22b1da18e00e98d78b0f7.wasm',size:14828458,sha256:'5a4ed1017eda113144c86ae839c22c610afebcfebfa22b1da18e00e98d78b0f7'} as const;
export type ReadImageRuntime=(bucket:string,path:string)=>Promise<Uint8Array>;
export async function loadImageRuntime(read:ReadImageRuntime){
 const bytes=await read(IMAGE_RUNTIME.bucket,IMAGE_RUNTIME.path);
 if(bytes.length!==IMAGE_RUNTIME.size)throw new Error('image_runtime_size_mismatch');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==IMAGE_RUNTIME.sha256)throw new Error('image_runtime_hash_mismatch');
 return bytes;
}
