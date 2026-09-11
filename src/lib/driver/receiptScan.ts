import {
  BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,
  type ReceiptScanQualityPolicy,
  type ReceiptScanQualityThresholds,
} from '@/lib/driver/receiptQualityPolicy';

export const MIN_RECEIPT_SOURCE_PIXELS = BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS.min_source_pixels;
export const MIN_RECEIPT_SHORT_SIDE = BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS.min_processed_short_side;
const MAX_RECEIPT_OUTPUT_SIDE = 2_400;
const THUMBNAIL_OUTPUT_SIDE = 480;

export interface ReceiptPoint { x: number; y: number }
export interface ReceiptCorners {
  topLeft: ReceiptPoint;
  topRight: ReceiptPoint;
  bottomRight: ReceiptPoint;
  bottomLeft: ReceiptPoint;
}
export interface ReceiptDetection {
  present: boolean;
  confidence: number;
  corners: ReceiptCorners | null;
  metrics: {
    areaRatio: number;
    aspectRatio: number;
    edgeContrast: number;
  };
}
export interface ReceiptCrop { left: number; top: number; right: number; bottom: number }
export type ReceiptRotation = 0 | 90 | 180 | 270;

export interface ReceiptScanQuality {
  accepted: boolean;
  requiresConfirmation: boolean;
  sourceWidth: number;
  sourceHeight: number;
  processedWidth: number;
  processedHeight: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  glareRatio: number;
  edgeCutRisk: boolean;
  estimatedDpi: number;
  processingMs: number;
  warnings: string[];
  rejectionReasons: string[];
}

export interface ReceiptScanResult {
  original: File;
  processed: File;
  thumbnail?: File;
  originalHash?: string;
  processedHash?: string;
  thumbnailHash?: string;
  capturedAt: string;
  scanMode: 'document_scan' | 'manual_crop' | 'native_document_scan';
  crop: ReceiptCrop;
  corners?: ReceiptCorners;
  rotation?: ReceiptRotation;
  quality: ReceiptScanQuality;
  qualityPolicy?: ReceiptScanQualityPolicy;
  qualityConfirmed?: boolean;
}

interface LineFit { slope: number; intercept: number }

const clamp = (value:number,min:number,max:number) => Math.min(max,Math.max(min,value));
const luminanceAt = (pixels:Uint8ClampedArray,offset:number) =>
  pixels[offset]*0.299+pixels[offset+1]*0.587+pixels[offset+2]*0.114;

export function normalizeReceiptCrop(crop:ReceiptCrop):ReceiptCrop {
  const left=clamp(crop.left,0,0.8),top=clamp(crop.top,0,0.8);
  return {left,top,right:clamp(crop.right,left+0.15,1),bottom:clamp(crop.bottom,top+0.15,1)};
}

export function cropToReceiptCorners(crop:ReceiptCrop):ReceiptCorners {
  const value=normalizeReceiptCrop(crop);
  return {topLeft:{x:value.left,y:value.top},topRight:{x:value.right,y:value.top},
    bottomRight:{x:value.right,y:value.bottom},bottomLeft:{x:value.left,y:value.bottom}};
}

export function receiptCornersToCrop(corners:ReceiptCorners):ReceiptCrop {
  return normalizeReceiptCrop({left:Math.min(corners.topLeft.x,corners.bottomLeft.x),
    top:Math.min(corners.topLeft.y,corners.topRight.y),right:Math.max(corners.topRight.x,corners.bottomRight.x),
    bottom:Math.max(corners.bottomLeft.y,corners.bottomRight.y)});
}

function polygonArea(corners:ReceiptCorners) {
  const points=[corners.topLeft,corners.topRight,corners.bottomRight,corners.bottomLeft];
  return Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y;},0)/2);
}

export function normalizeReceiptCorners(corners:ReceiptCorners):ReceiptCorners {
  const value:ReceiptCorners={
    topLeft:{x:clamp(corners.topLeft.x,0,1),y:clamp(corners.topLeft.y,0,1)},
    topRight:{x:clamp(corners.topRight.x,0,1),y:clamp(corners.topRight.y,0,1)},
    bottomRight:{x:clamp(corners.bottomRight.x,0,1),y:clamp(corners.bottomRight.y,0,1)},
    bottomLeft:{x:clamp(corners.bottomLeft.x,0,1),y:clamp(corners.bottomLeft.y,0,1)},
  };
  if(value.topRight.x-value.topLeft.x<0.08||value.bottomRight.x-value.bottomLeft.x<0.08
    ||value.bottomLeft.y-value.topLeft.y<0.08||value.bottomRight.y-value.topRight.y<0.08||polygonArea(value)<0.04){
    return cropToReceiptCorners(receiptCornersToCrop(value));
  }
  return value;
}

interface AxisDetection { crop:ReceiptCrop; edgeContrast:number }

function strongestEdge(scores:number[],start:number,end:number){let best=start,bestScore=-1;for(let index=start;index<=end;index+=1){
  const score=scores[index]??0;if(score>bestScore){best=index;bestScore=score;}}return {index:best,score:Math.max(0,bestScore)};}

function axisDetection(pixels:Uint8ClampedArray,width:number,height:number):AxisDetection {
  if(width<20||height<20||pixels.length<width*height*4)return {crop:{left:.03,top:.03,right:.97,bottom:.97},edgeContrast:0};
  const xs=new Array<number>(width).fill(0),ys=new Array<number>(height).fill(0);
  const stride=Math.max(1,Math.floor(Math.max(width,height)/900));
  for(let y=stride;y<height;y+=stride)for(let x=stride;x<width;x+=stride){const offset=(y*width+x)*4;
    xs[x]+=Math.abs(luminanceAt(pixels,offset)-luminanceAt(pixels,offset-stride*4));
    ys[y]+=Math.abs(luminanceAt(pixels,offset)-luminanceAt(pixels,offset-stride*width*4));}
  const left=strongestEdge(xs,Math.floor(width*.01),Math.floor(width*.42)),right=strongestEdge(xs,Math.ceil(width*.58),Math.floor(width*.99)),
    top=strongestEdge(ys,Math.floor(height*.01),Math.floor(height*.42)),bottom=strongestEdge(ys,Math.ceil(height*.58),Math.floor(height*.99)),
    verticalSamples=Math.max(1,Math.floor((height-1)/stride)),horizontalSamples=Math.max(1,Math.floor((width-1)/stride));
  return {crop:normalizeReceiptCrop({left:left.index/width,right:right.index/width,top:top.index/height,bottom:bottom.index/height}),
    edgeContrast:(left.score/verticalSamples+right.score/verticalSamples+top.score/horizontalSamples+bottom.score/horizontalSamples)/4};
}

function axisCrop(pixels:Uint8ClampedArray,width:number,height:number):ReceiptCrop {
  return axisDetection(pixels,width,height).crop;
}

function fitLine(points:Array<[number,number]>,fallback:LineFit):LineFit {
  if(points.length<6)return fallback;
  const meanX=points.reduce((sum,p)=>sum+p[0],0)/points.length,meanY=points.reduce((sum,p)=>sum+p[1],0)/points.length;
  let numerator=0,denominator=0;for(const [x,y] of points){numerator+=(x-meanX)*(y-meanY);denominator+=(x-meanX)**2;}
  if(denominator<.0001)return fallback;const slope=numerator/denominator;return {slope,intercept:meanY-slope*meanX};
}

function verticalFit(pixels:Uint8ClampedArray,width:number,height:number,center:number):LineFit {
  const points:Array<[number,number]>=[],radius=Math.max(4,Math.floor(width*.1)),step=Math.max(2,Math.floor(height/180));
  for(let y=Math.floor(height*.06);y<height*.94;y+=step){let best=center,score=-1;
    for(let x=Math.max(1,center-radius);x<=Math.min(width-2,center+radius);x+=1){const offset=(y*width+x)*4;
      const current=Math.abs(luminanceAt(pixels,offset+4)-luminanceAt(pixels,offset-4));if(current>score){score=current;best=x;}}
    if(score>=8)points.push([y,best]);}
  return fitLine(points,{slope:0,intercept:center});
}

function horizontalFit(pixels:Uint8ClampedArray,width:number,height:number,center:number):LineFit {
  const points:Array<[number,number]>=[],radius=Math.max(4,Math.floor(height*.1)),step=Math.max(2,Math.floor(width/180));
  for(let x=Math.floor(width*.06);x<width*.94;x+=step){let best=center,score=-1;
    for(let y=Math.max(1,center-radius);y<=Math.min(height-2,center+radius);y+=1){const offset=(y*width+x)*4;
      const current=Math.abs(luminanceAt(pixels,offset+width*4)-luminanceAt(pixels,offset-width*4));if(current>score){score=current;best=y;}}
    if(score>=8)points.push([x,best]);}
  return fitLine(points,{slope:0,intercept:center});
}

function intersect(vertical:LineFit,horizontal:LineFit,width:number,height:number):ReceiptPoint {
  const denominator=1-vertical.slope*horizontal.slope;
  const x=Math.abs(denominator)<.001?vertical.intercept:(vertical.slope*horizontal.intercept+vertical.intercept)/denominator;
  return {x:clamp(x/width,0,1),y:clamp((horizontal.slope*x+horizontal.intercept)/height,0,1)};
}

/** Detects whether a plausible paper document is present. A geometric candidate
 * is deliberately not exposed as detected corners until its borders have enough
 * contrast and its area and proportions look like a document. */
export function detectReceiptDocument(pixels:Uint8ClampedArray,width:number,height:number):ReceiptDetection {
  const axis=axisDetection(pixels,width,height),crop=axis.crop,left=verticalFit(pixels,width,height,Math.round(crop.left*width)),
    right=verticalFit(pixels,width,height,Math.round(crop.right*width)),top=horizontalFit(pixels,width,height,Math.round(crop.top*height)),
    bottom=horizontalFit(pixels,width,height,Math.round(crop.bottom*height));
  const candidate=normalizeReceiptCorners({topLeft:intersect(left,top,width,height),topRight:intersect(right,top,width,height),
    bottomRight:intersect(right,bottom,width,height),bottomLeft:intersect(left,bottom,width,height)});
  const topWidth=edgeLength(candidate.topLeft,candidate.topRight,width,height),bottomWidth=edgeLength(candidate.bottomLeft,candidate.bottomRight,width,height),
    leftHeight=edgeLength(candidate.topLeft,candidate.bottomLeft,width,height),rightHeight=edgeLength(candidate.topRight,candidate.bottomRight,width,height),
    documentWidth=(topWidth+bottomWidth)/2,documentHeight=(leftHeight+rightHeight)/2,areaRatio=polygonArea(candidate),
    aspectRatio=documentHeight>0?documentWidth/documentHeight:0,areaPlausible=areaRatio>=.12&&areaRatio<=.96,
    proportionPlausible=aspectRatio>=.25&&aspectRatio<=4,contrastPlausible=axis.edgeContrast>=18;
  const areaConfidence=clamp((areaRatio-.08)/.2,0,1),aspectConfidence=aspectRatio>0
    ?clamp(1-Math.abs(Math.log(aspectRatio))/Math.log(8),0,1):0,contrastConfidence=clamp((axis.edgeContrast-8)/32,0,1),
    confidence=Number((areaConfidence*.25+aspectConfidence*.15+contrastConfidence*.6).toFixed(3)),
    present=areaPlausible&&proportionPlausible&&contrastPlausible&&confidence>=.55;
  return {present,confidence,corners:present?candidate:null,metrics:{areaRatio:Number(areaRatio.toFixed(4)),
    aspectRatio:Number(aspectRatio.toFixed(3)),edgeContrast:Number(axis.edgeContrast.toFixed(2))}};
}

/** Compatibility wrapper for manual processing of still images. Live automatic
 * capture must use detectReceiptDocument so a fallback polygon is never treated
 * as proof that paper is present. */
export function detectReceiptCorners(pixels:Uint8ClampedArray,width:number,height:number):ReceiptCorners {
  const detection=detectReceiptDocument(pixels,width,height);
  return detection.corners??cropToReceiptCorners(axisCrop(pixels,width,height));
}

export function detectReceiptCrop(pixels:Uint8ClampedArray,width:number,height:number):ReceiptCrop {
  return receiptCornersToCrop(detectReceiptCorners(pixels,width,height));
}

export function receiptCornersDistance(first:ReceiptCorners,second:ReceiptCorners){
  const keys=(['topLeft','topRight','bottomRight','bottomLeft'] as const);
  return Math.max(...keys.map(key=>Math.hypot(first[key].x-second[key].x,first[key].y-second[key].y)));
}

export function areReceiptCornersStable(history:ReceiptCorners[],tolerance=.018){
  if(history.length<4)return false;const recent=history.slice(-4);
  return recent.slice(1).every((corners,index)=>receiptCornersDistance(recent[index],corners)<=tolerance);
}

export function nextReceiptCornerHistory(history:ReceiptCorners[],detection:ReceiptDetection,maxLength=4):ReceiptCorners[] {
  if(!detection.present||!detection.corners)return [];
  return [...history.slice(-(Math.max(1,maxLength)-1)),detection.corners];
}

function edgeCutSeverity(corners:ReceiptCorners):'none'|'warning'|'rejection'{const margin=Math.min(corners.topLeft.x,corners.topLeft.y,
  corners.topRight.y,1-corners.topRight.x,1-corners.bottomRight.x,1-corners.bottomRight.y,1-corners.bottomLeft.y,corners.bottomLeft.x);
  return margin<.006?'rejection':margin<.015?'warning':'none';}

export function evaluateReceiptQuality(pixels:Uint8ClampedArray,sourceWidth:number,sourceHeight:number,
  processedWidth:number,processedHeight:number,options:{corners?:ReceiptCorners;processingMs?:number;
    thresholds?:ReceiptScanQualityThresholds}={}):ReceiptScanQuality {
  const thresholds=options.thresholds??BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS;
  const count=Math.max(1,Math.floor(pixels.length/4)),values=new Float64Array(count);let sum=0,glare=0;
  for(let pixel=0;pixel<count;pixel+=1){const value=luminanceAt(pixels,pixel*4);values[pixel]=value;sum+=value;if(value>=250)glare+=1;}
  const brightness=sum/count;let variance=0,sharpnessTotal=0;
  for(let y=1;y<processedHeight-1;y+=1)for(let x=1;x<processedWidth-1;x+=1){const index=y*processedWidth+x,value=values[index];
    variance+=(value-brightness)**2;sharpnessTotal+=Math.abs(values[index-1]+values[index+1]+values[index-processedWidth]+values[index+processedWidth]-4*value);}
  const interior=Math.max(1,(processedWidth-2)*(processedHeight-2)),contrast=Math.sqrt(variance/interior),sharpness=sharpnessTotal/interior,
    glareRatio=glare/count,edgeCut=options.corners?edgeCutSeverity(options.corners):'none',edgeCutRisk=edgeCut!=='none',warnings:string[]=[],rejectionReasons:string[]=[];
  if(sourceWidth*sourceHeight<thresholds.min_source_pixels)rejectionReasons.push(`A câmera precisa gerar pelo menos ${Math.ceil(thresholds.min_source_pixels/1_000_000)} MP.`);
  if(Math.min(processedWidth,processedHeight)<thresholds.min_processed_short_side)rejectionReasons.push('A área recortada ficou pequena demais.');
  if(brightness<thresholds.min_brightness_reject)rejectionReasons.push('A imagem está escura. Use mais iluminação.');
  else if(brightness<thresholds.min_brightness_warn)warnings.push('A imagem está um pouco escura. Confirme se todo o texto está legível.');
  if(brightness>thresholds.max_brightness_reject)rejectionReasons.push('Há reflexo ou excesso de luz escondendo o papel.');
  else if(glareRatio>thresholds.max_glare_warn)warnings.push('Há reflexos na imagem. Confirme se nenhum dado ficou encoberto.');
  if(contrast<thresholds.min_contrast_reject)rejectionReasons.push('O texto tem pouco contraste com o papel.');
  else if(contrast<thresholds.min_contrast_warn)warnings.push('O contraste está baixo. Confirme a leitura antes de continuar.');
  if(sharpness<thresholds.min_sharpness_reject)rejectionReasons.push('A imagem parece desfocada. Firme o celular e tente novamente.');
  else if(sharpness<thresholds.min_sharpness_warn)warnings.push('A nitidez está intermediária. Confirme a leitura antes de continuar.');
  if(edgeCut==='rejection')rejectionReasons.push('O papel foi cortado pela borda da foto. Afaste o celular e fotografe novamente.');
  else if(edgeCut==='warning')(thresholds.edge_cut_action==='reject'?rejectionReasons:warnings).push(thresholds.edge_cut_action==='reject'
    ?'O papel encosta no limite da foto. Fotografe novamente sem cortar as bordas.'
    :'O papel encosta no limite da foto. Confirme se nenhuma borda foi cortada.');
  const accepted=rejectionReasons.length===0;
  return {accepted,requiresConfirmation:accepted&&warnings.length>0,sourceWidth,sourceHeight,processedWidth,processedHeight,
    brightness:Number(brightness.toFixed(2)),contrast:Number(contrast.toFixed(2)),sharpness:Number(sharpness.toFixed(2)),
    glareRatio:Number(glareRatio.toFixed(4)),edgeCutRisk,estimatedDpi:Math.round(Math.min(processedWidth,processedHeight)/4.5),
    processingMs:Math.round(options.processingMs??0),warnings:[...rejectionReasons,...warnings],rejectionReasons};
}

async function decodeImage(file:File):Promise<ImageBitmap|HTMLImageElement>{
  if(typeof createImageBitmap==='function')return createImageBitmap(file,{imageOrientation:'from-image'});
  return new Promise((resolve,reject)=>{const image=new Image(),url=URL.createObjectURL(file);
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não foi possível abrir a foto do canhoto.'));};image.src=url;});
}

function canvasBlob(canvas:HTMLCanvasElement,quality=.9):Promise<Blob>{return new Promise((resolve,reject)=>canvas.toBlob(
  blob=>blob?resolve(blob):reject(new Error('Não foi possível gerar o scan do canhoto.')),'image/jpeg',quality));}
function edgeLength(a:ReceiptPoint,b:ReceiptPoint,width:number,height:number){return Math.hypot((b.x-a.x)*width,(b.y-a.y)*height);}

interface ReceiptProjection { a:number;b:number;c:number;d:number;e:number;f:number;g:number;h:number }
function receiptProjection(corners:ReceiptCorners,width:number,height:number):ReceiptProjection {
  const x0=corners.topLeft.x*(width-1),y0=corners.topLeft.y*(height-1),x1=corners.topRight.x*(width-1),y1=corners.topRight.y*(height-1),
    x2=corners.bottomRight.x*(width-1),y2=corners.bottomRight.y*(height-1),x3=corners.bottomLeft.x*(width-1),y3=corners.bottomLeft.y*(height-1),
    dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,denominator=dx1*dy2-dx2*dy1;
  const g=Math.abs(denominator)<1e-8?0:(dx3*dy2-dx2*dy3)/denominator,
    h=Math.abs(denominator)<1e-8?0:(dx1*dy3-dx3*dy1)/denominator;
  return {a:x1-x0+g*x1,b:x3-x0+h*x3,c:x0,d:y1-y0+g*y1,e:y3-y0+h*y3,f:y0,g,h};
}

export function projectReceiptPoint(corners:ReceiptCorners,width:number,height:number,u:number,v:number):ReceiptPoint {
  const projection=receiptProjection(corners,width,height),denominator=projection.g*u+projection.h*v+1;
  return {x:(projection.a*u+projection.b*v+projection.c)/denominator,
    y:(projection.d*u+projection.e*v+projection.f)/denominator};
}

function sampleBilinear(pixels:Uint8ClampedArray,width:number,height:number,x:number,y:number,channel:number){
  const left=clamp(Math.floor(x),0,width-1),top=clamp(Math.floor(y),0,height-1),right=Math.min(width-1,left+1),bottom=Math.min(height-1,top+1),
    horizontal=clamp(x-left,0,1),vertical=clamp(y-top,0,1),topValue=pixels[(top*width+left)*4+channel]*(1-horizontal)+pixels[(top*width+right)*4+channel]*horizontal,
    bottomValue=pixels[(bottom*width+left)*4+channel]*(1-horizontal)+pixels[(bottom*width+right)*4+channel]*horizontal;
  return topValue*(1-vertical)+bottomValue*vertical;
}

function perspectiveScan(source:ImageData,corners:ReceiptCorners):HTMLCanvasElement {
  const naturalWidth=(edgeLength(corners.topLeft,corners.topRight,source.width,source.height)+edgeLength(corners.bottomLeft,corners.bottomRight,source.width,source.height))/2;
  const naturalHeight=(edgeLength(corners.topLeft,corners.bottomLeft,source.width,source.height)+edgeLength(corners.topRight,corners.bottomRight,source.width,source.height))/2;
  const scale=Math.min(1,MAX_RECEIPT_OUTPUT_SIDE/Math.max(naturalWidth,naturalHeight)),width=Math.max(1,Math.round(naturalWidth*scale)),height=Math.max(1,Math.round(naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('Este navegador não permite corrigir a perspectiva da foto.');const output=context.createImageData(width,height),from=source.data,to=output.data;
  const projection=receiptProjection(corners,source.width,source.height);
  for(let y=0;y<height;y+=1){const v=height===1?0:y/(height-1);
    for(let x=0;x<width;x+=1){const u=width===1?0:x/(width-1),denominator=projection.g*u+projection.h*v+1,
        sx=clamp((projection.a*u+projection.b*v+projection.c)/denominator,0,source.width-1),
        sy=clamp((projection.d*u+projection.e*v+projection.f)/denominator,0,source.height-1),target=(y*width+x)*4,
        red=sampleBilinear(from,source.width,source.height,sx,sy,0),green=sampleBilinear(from,source.width,source.height,sx,sy,1),
        blue=sampleBilinear(from,source.width,source.height,sx,sy,2),light=red*.299+green*.587+blue*.114,correction=clamp((208-light)*.08,-10,10);
      to[target]=clamp((red-128)*1.08+128+correction,0,255);to[target+1]=clamp((green-128)*1.08+128+correction,0,255);
      to[target+2]=clamp((blue-128)*1.08+128+correction,0,255);to[target+3]=255;}}
  context.putImageData(output,0,0);return canvas;
}

function rotateCanvas(source:HTMLCanvasElement,rotation:ReceiptRotation){if(rotation===0)return source;const canvas=document.createElement('canvas'),quarter=rotation===90||rotation===270;
  canvas.width=quarter?source.height:source.width;canvas.height=quarter?source.width:source.height;const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('Este navegador não permite rotacionar o canhoto.');context.translate(canvas.width/2,canvas.height/2);context.rotate(rotation*Math.PI/180);
  context.drawImage(source,-source.width/2,-source.height/2);return canvas;}

async function createThumbnail(source:HTMLCanvasElement){const scale=Math.min(1,THUMBNAIL_OUTPUT_SIDE/Math.max(source.width,source.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));const context=canvas.getContext('2d');
  if(!context)throw new Error('Este navegador não permite gerar a miniatura do canhoto.');context.drawImage(source,0,0,canvas.width,canvas.height);
  return new File([await canvasBlob(canvas,.78)],'canhoto-miniatura.jpg',{type:'image/jpeg',lastModified:Date.now()});}

export async function sha256File(file:Blob){if(!globalThis.crypto?.subtle)throw new Error('Este aparelho não oferece verificação segura dos arquivos.');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

export async function processReceiptScan(file:File,options:ReceiptCrop|{corners?:ReceiptCorners;rotation?:ReceiptRotation;
  qualityPolicy?:ReceiptScanQualityPolicy}={}):Promise<ReceiptScanResult>{
  const started=performance.now(),image=await decodeImage(file),sourceWidth=image.width,sourceHeight=image.height,detectionScale=Math.min(1,1000/Math.max(sourceWidth,sourceHeight)),
    detection=document.createElement('canvas');detection.width=Math.max(1,Math.round(sourceWidth*detectionScale));detection.height=Math.max(1,Math.round(sourceHeight*detectionScale));
  const detectionContext=detection.getContext('2d',{willReadFrequently:true});if(!detectionContext)throw new Error('Este navegador não permite processar a foto do canhoto.');
  detectionContext.drawImage(image,0,0,detection.width,detection.height);const detectionPixels=detectionContext.getImageData(0,0,detection.width,detection.height),legacy='left' in options,
    requested=legacy?cropToReceiptCorners(options):options.corners,documentDetection=requested?null:detectReceiptDocument(detectionPixels.data,detection.width,detection.height),
    corners=normalizeReceiptCorners(requested??documentDetection?.corners??detectReceiptCorners(detectionPixels.data,detection.width,detection.height)),
    full=document.createElement('canvas');full.width=sourceWidth;full.height=sourceHeight;const fullContext=full.getContext('2d',{willReadFrequently:true});
  if(!fullContext)throw new Error('Este navegador não permite recortar a foto do canhoto.');fullContext.drawImage(image,0,0,sourceWidth,sourceHeight);
  if('close' in image&&typeof image.close==='function')image.close();const rotation=legacy?0:(options.rotation??0),output=rotateCanvas(perspectiveScan(fullContext.getImageData(0,0,sourceWidth,sourceHeight),corners),rotation),
    outputContext=output.getContext('2d',{willReadFrequently:true});if(!outputContext)throw new Error('Este navegador não permite validar o scan do canhoto.');
  const qualityPolicy=legacy?undefined:options.qualityPolicy,
    evaluatedQuality=evaluateReceiptQuality(outputContext.getImageData(0,0,output.width,output.height).data,sourceWidth,sourceHeight,output.width,output.height,
      {corners,processingMs:performance.now()-started,thresholds:qualityPolicy?.thresholds}),
    quality=!requested&&documentDetection&&!documentDetection.present?{...evaluatedQuality,accepted:false,requiresConfirmation:false,
      warnings:['Não foi possível confirmar as quatro bordas do papel. Ajuste os cantos manualmente.',...evaluatedQuality.warnings],
      rejectionReasons:['Não foi possível confirmar as quatro bordas do papel. Ajuste os cantos manualmente.',...evaluatedQuality.rejectionReasons]}:evaluatedQuality,
    processed=new File([await canvasBlob(output)],'canhoto-digitalizado.jpg',{type:'image/jpeg',lastModified:Date.now()}),thumbnail=await createThumbnail(output),
    [originalHash,processedHash,thumbnailHash]=await Promise.all([sha256File(file),sha256File(processed),sha256File(thumbnail)]);
  const completedQuality={...quality,processingMs:Math.round(performance.now()-started)};
  return {original:file,processed,thumbnail,originalHash,processedHash,thumbnailHash,capturedAt:new Date().toISOString(),scanMode:requested?'manual_crop':'document_scan',
    crop:receiptCornersToCrop(corners),corners,rotation,quality:completedQuality,qualityPolicy,qualityConfirmed:!completedQuality.requiresConfirmation};
}

export function confirmReceiptScanQuality(scan:ReceiptScanResult):ReceiptScanResult{return {...scan,qualityConfirmed:true};}
export function isReceiptScanAcceptable(scan:ReceiptScanResult|null):scan is ReceiptScanResult {
  return Boolean(scan?.quality.accepted&&(!scan.quality.requiresConfirmation||scan.qualityConfirmed));
}
