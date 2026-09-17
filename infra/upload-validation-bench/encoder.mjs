import {ImageMagick,MagickFormat,ResourceLimits} from '@imagemagick/magick-wasm';
ResourceLimits.memory=64n*1024n*1024n;
ResourceLimits.maxMemoryRequest=64n*1024n*1024n;
ResourceLimits.disk=0n;
ResourceLimits.area=2_000_000n;
ResourceLimits.width=4096n;ResourceLimits.height=4096n;
ResourceLimits.listLength=4n;ResourceLimits.maxProfileSize=256n*1024n;ResourceLimits.time=1n;
export const encoder={encode(bytes,format){
 const codec=format==='jpeg'?MagickFormat.Jpeg:MagickFormat.Png;
 return ImageMagick.read(bytes,codec,img=>{img.autoOrient();img.strip();img.quality=85;return img.write(codec,data=>Uint8Array.from(data));});
}};

