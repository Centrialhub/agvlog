import {deflateSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {initializeImageMagick,ImageMagick,MagickFormat} from '@imagemagick/magick-wasm';
import {createHash} from 'node:crypto';
const directory=new URL('./fixtures/',import.meta.url);mkdirSync(directory,{recursive:true});
function chunk(type,data){const raw=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of raw){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,raw,sum]);}
function png(width,height){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=1;x<=width*3;x++)raw[y*(width*3+1)+x]=(x+y)%256;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
await initializeImageMagick(readFileSync(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))));
const records=[];
function save(name,bytes,expected){writeFileSync(new URL(name,directory),bytes);records.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),expected});}
for(const [width,height] of [[1,1],[640,480],[1600,1200],[2000,1000],[2000,1200]]){
 const source=png(width,height),expected=width*height>2000000?'reject_pixels':width*height===2000000?'allow_or_resource_rejection':'reencode_within_budget';
 save(`${width}x${height}.png`,source,expected);
 save(`${width}x${height}.jpg`,ImageMagick.read(source,img=>img.write(MagickFormat.Jpeg,data=>Uint8Array.from(data))),expected);
}
const small=png(64,64),animation=Buffer.alloc(8);animation.writeUInt32BE(2);
save('animation.png',Buffer.concat([small.subarray(0,33),chunk('acTL',animation),small.subarray(33)]),'reject_animation');
save('trailing.png',Buffer.concat([small,Buffer.from('extra')]),'reject_trailing');
const corrupt=Buffer.from(small);corrupt[corrupt.length-17]^=1;save('corrupt-crc.png',corrupt,'reject_codec');
save('invalid.jpg',Buffer.from([255,216,255,217]),'reject_header');
writeFileSync(new URL('manifest.json',directory),JSON.stringify({synthetic:true,no_client_files:true,records},null,2));
console.log(JSON.stringify({directory:directory.pathname,count:records.length,records},null,2));