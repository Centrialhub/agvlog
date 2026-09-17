import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {initializeImageMagick,ImageMagick,MagickFormat} from '@imagemagick/magick-wasm';
import {inspectQuarantineImage,sanitizeQuarantineImage} from '../../supabase/functions/secure-upload/quarantine-image.ts';
const start=performance.now();
await initializeImageMagick(readFileSync(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))));
const {encoder}=await import('./encoder.mjs');
function chunk(type,data){const raw=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of raw){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,raw,sum]);}
function png(width,height){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=1;x<=width*3;x++)raw[y*(width*3+1)+x]=(x+y)%256;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const results=[];
for(const [width,height] of [[1,1],[640,480],[1600,1200],[2000,1000]]){
 const input=png(width,height);
 for(const format of ['png','jpeg']){

  const at=performance.now(),cpu=process.cpuUsage();
  try {const bytes=format==='png'?input:ImageMagick.read(input,img=>img.write(MagickFormat.Jpeg,data=>Uint8Array.from(data)));const output=sanitizeQuarantineImage(bytes,encoder);results.push({width,height,format,success:true,input:bytes.length,output:output.bytes.length,ms:performance.now()-at,cpu:process.cpuUsage(cpu),rss:process.memoryUsage().rss});}
  catch(error){results.push({width,height,format,success:false,error:error.message,ms:performance.now()-at,rss:process.memoryUsage().rss});}
 }
}
try{inspectQuarantineImage(png(2000,1200));throw new Error('Expected preflight rejection');}catch(error){results.push({oversized_pixels:error.message});}
console.log(JSON.stringify({runtime:process.version,total_ms:performance.now()-start,results,note:'Synthetic images, local Node; not Edge certification'},null,2));
