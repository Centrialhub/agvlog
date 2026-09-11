export const IMAGE_LIMITS={bytes:5*1024*1024,pixels:2_000_000,side:4096,output:5*1024*1024,elapsedMs:1200} as const;
export type ImageFormat='jpeg'|'png';
export function inspectQuarantineImage(bytes:Uint8Array):{format:ImageFormat;width:number;height:number}{
 if(!bytes.length||bytes.length>IMAGE_LIMITS.bytes)throw new Error('image_size_limit');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const dimensions=(format:ImageFormat,width:number,height:number)=>{
  if(!width||!height||width>IMAGE_LIMITS.side||height>IMAGE_LIMITS.side||width*height>IMAGE_LIMITS.pixels)throw new Error('image_pixel_limit');
  return {format,width,height};
 };
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)){
  let offset=8,first=true,foundEnd=false;let result:{format:ImageFormat;width:number;height:number}|undefined;
  while(offset+12<=bytes.length){
   const length=view.getUint32(offset),end=offset+12+length;
   if(end>bytes.length)throw new Error('image_truncated');
   const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
   if(first){if(kind!=='IHDR'||length!==13||bytes[offset+16]>8)throw new Error('image_png_header');result=dimensions('png',view.getUint32(offset+8),view.getUint32(offset+12));first=false;}
   else if(kind==='IHDR')throw new Error('image_png_header');
   if(kind==='acTL'||kind==='fcTL'||kind==='fdAT')throw new Error('image_animation_not_supported');
   if(kind==='IEND'){if(length!==0||end!==bytes.length)throw new Error('image_trailing_content');foundEnd=true;break;}
   offset=end;
  }
  if(!foundEnd||!result)throw new Error('image_truncated');return result;
 }
 if(bytes[0]===255&&bytes[1]===216){
  if(bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new Error('image_truncated');
  let offset=2;let result:{format:ImageFormat;width:number;height:number}|undefined;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)throw new Error('image_jpeg_header');
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===218){if(!result)throw new Error('image_jpeg_header');return result;}
   if(marker===216||marker===217||marker===0)throw new Error('image_jpeg_header');
   const length=view.getUint16(offset);if(length<2||offset+length>bytes.length)throw new Error('image_truncated');
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(![192,194].includes(marker)||length<8||bytes[offset+2]!==8||result)throw new Error('image_jpeg_mode');
    result=dimensions('jpeg',view.getUint16(offset+5),view.getUint16(offset+3));
   }
   offset+=length;
  }
  throw new Error('image_jpeg_header');
 }
 throw new Error('image_format_not_supported');
}
export interface QuarantineImageEncoder {encode:(bytes:Uint8Array,format:ImageFormat)=>Uint8Array}
export function sanitizeQuarantineImage(bytes:Uint8Array,encoder:QuarantineImageEncoder,clock:()=>number=()=>performance.now()){
 const source=inspectQuarantineImage(bytes),started=clock();
 const output=encoder.encode(bytes,source.format);
 if(clock()-started>IMAGE_LIMITS.elapsedMs)throw new Error('image_processing_budget');
 if(!output.length||output.length>IMAGE_LIMITS.output)throw new Error('image_output_limit');
 const derived=inspectQuarantineImage(output);
 if(derived.format!==source.format||derived.width*derived.height!==source.width*source.height)throw new Error('image_output_mismatch');
 return {state:'sanitized_derivative' as const,method:'jpeg-png-reencode-v1' as const,mime:source.format==='jpeg'?'image/jpeg' as const:'image/png' as const,bytes:output};
}
