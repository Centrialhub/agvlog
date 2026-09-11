import {loadImageRuntime,type ReadImageRuntime} from './quarantine-runtime.ts';
import {ImageMagick,initializeImageMagick,MagickFormat,ResourceLimits} from 'npm:@imagemagick/magick-wasm@0.0.43';
import {inspectQuarantineImage,sanitizeQuarantineImage} from './quarantine-image.ts';
let initialized:Promise<void>|undefined;
async function initialize(read:ReadImageRuntime){
 const bytes=await loadImageRuntime(read);
 await initializeImageMagick(bytes);
 ResourceLimits.memory=64n*1024n*1024n;ResourceLimits.maxMemoryRequest=64n*1024n*1024n;
 ResourceLimits.disk=0n;ResourceLimits.area=2_000_000n;ResourceLimits.width=4096n;ResourceLimits.height=4096n;
 ResourceLimits.listLength=4n;ResourceLimits.maxProfileSize=256n*1024n;ResourceLimits.time=1n;
}
export async function reencodeQuarantinedImage(bytes:Uint8Array,read:ReadImageRuntime){
 inspectQuarantineImage(bytes);initialized??=initialize(read).catch(error=>{initialized=undefined;throw error;});await initialized;
 return sanitizeQuarantineImage(bytes,{encode(input,format){
  const codec=format==='jpeg'?MagickFormat.Jpeg:MagickFormat.Png;
  return ImageMagick.read(input,codec,image=>{
   image.autoOrient();image.strip();image.quality=85;
   return image.write(codec,data=>Uint8Array.from(data));
  });
 }});
}

