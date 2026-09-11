import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Crop, FileCheck2, ImageIcon, RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  areReceiptCornersStable,
  confirmReceiptScanQuality,
  detectReceiptDocument,
  nextReceiptCornerHistory,
  type ReceiptCorners,
  type ReceiptPoint,
  type ReceiptRotation,
  type ReceiptScanResult,
  processReceiptScan,
} from '@/lib/driver/receiptScan';
import type { ReceiptScanQualityPolicy } from '@/lib/driver/receiptQualityPolicy';
import { validateUploadFile } from '@/lib/uploadPolicy';

interface DeliveryReceiptScannerProps {
  value: ReceiptScanResult | null;
  qualityPolicy: ReceiptScanQualityPolicy;
  onChange: (value: ReceiptScanResult | null) => void;
  onError: (message: string) => void;
}

const initialCorners:ReceiptCorners={topLeft:{x:.03,y:.03},topRight:{x:.97,y:.03},bottomRight:{x:.97,y:.97},bottomLeft:{x:.03,y:.97}};
const cornerLabels={topLeft:'Canto superior esquerdo',topRight:'Canto superior direito',bottomRight:'Canto inferior direito',bottomLeft:'Canto inferior esquerdo'} as const;
const cornerKeys=Object.keys(cornerLabels) as Array<keyof ReceiptCorners>;

const policyLabels:Record<ReceiptScanQualityPolicy['source'],string>={client:'Regra específica do cliente',tenant:'Regra da empresa',baseline:'Padrão do aplicativo'};

export default function DeliveryReceiptScanner({value,qualityPolicy,onChange,onError}:DeliveryReceiptScannerProps) {
  const cameraInputRef=useRef<HTMLInputElement>(null),galleryRef=useRef<HTMLInputElement>(null),videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null),historyRef=useRef<ReceiptCorners[]>([]),capturingRef=useRef(false);
  const captureLiveRef=useRef<(detected?:ReceiptCorners|null)=>Promise<void>>(async()=>undefined);
  const [busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[cameraOpen,setCameraOpen]=useState(false);
  const [corners,setCorners]=useState<ReceiptCorners>(initialCorners),[liveCorners,setLiveCorners]=useState<ReceiptCorners|null>(null);
  const [preview,setPreview]=useState<string|null>(null),[sourcePreview,setSourcePreview]=useState<string|null>(null);

  useEffect(()=>{
    if(!value){setPreview(null);setSourcePreview(null);return;}
    const processedUrl=URL.createObjectURL(value.processed),sourceUrl=URL.createObjectURL(value.original);
    setPreview(processedUrl);setSourcePreview(sourceUrl);setCorners(value.corners??initialCorners);
    return()=>{URL.revokeObjectURL(processedUrl);URL.revokeObjectURL(sourceUrl);};
  },[value]);

  const stopCamera=()=>{
    streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;historyRef.current=[];capturingRef.current=false;
    setCameraOpen(false);setLiveCorners(null);
  };
  useEffect(()=>()=>stopCamera(),[]);

  async function scan(file:File,scanCorners?:ReceiptCorners,rotation:ReceiptRotation=0){
    setBusy(true);
    try{validateUploadFile(file,'image');const result=await processReceiptScan(file,scanCorners?{corners:scanCorners,rotation,qualityPolicy}:{rotation,qualityPolicy});
      onChange(result);setEditing(false);stopCamera();
    }catch(error){onError(error instanceof Error?error.message:'Não foi possível digitalizar o canhoto.');}
    finally{setBusy(false);capturingRef.current=false;}
  }

  async function startCamera(){
    if(!navigator.mediaDevices?.getUserMedia){cameraInputRef.current?.click();return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      streamRef.current=stream;setCameraOpen(true);historyRef.current=[];
    }catch{cameraInputRef.current?.click();}
  }

  async function captureLive(detected=liveCorners){
    const video=videoRef.current;if(!video||!video.videoWidth||capturingRef.current)return;capturingRef.current=true;
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const context=canvas.getContext('2d');if(!context){capturingRef.current=false;onError('A câmera não permitiu capturar o canhoto.');return;}
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
    if(!blob){capturingRef.current=false;onError('A câmera não conseguiu gerar a foto.');return;}
    await scan(new File([blob],`canhoto-${Date.now()}.jpg`,{type:'image/jpeg',lastModified:Date.now()}),detected??undefined);
  }
  captureLiveRef.current=captureLive;

  useEffect(()=>{
    if(!cameraOpen||!videoRef.current||!streamRef.current)return;
    const video=videoRef.current;video.srcObject=streamRef.current;void video.play();
    const timer=window.setInterval(()=>{
      if(video.readyState<2||!video.videoWidth||capturingRef.current)return;
      const scale=Math.min(1,640/video.videoWidth),canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return;context.drawImage(video,0,0,canvas.width,canvas.height);
      const image=context.getImageData(0,0,canvas.width,canvas.height),detection=detectReceiptDocument(image.data,canvas.width,canvas.height);
      setLiveCorners(detection.corners);historyRef.current=nextReceiptCornerHistory(historyRef.current,detection);
      if(detection.corners&&areReceiptCornersStable(historyRef.current))void captureLiveRef.current(detection.corners);
    },350);
    return()=>window.clearInterval(timer);
  },[cameraOpen]);

  async function select(event:React.ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';if(file)await scan(file);}
  const setCorner=(key:keyof ReceiptCorners,point:ReceiptPoint)=>setCorners(current=>({...current,[key]:point}));
  const rotation=((value?.rotation??0)+90)%360 as ReceiptRotation;

  return <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="receipt-scan-title">
    <div className="flex items-start justify-between gap-3"><div><p id="receipt-scan-title" className="text-xs font-semibold">Canhoto físico <span className="text-destructive">*</span></p>
      <p className="text-[11px] text-muted-foreground">Enquadre o papel inteiro. A câmera detecta estabilidade, corrige perspectiva e valida a leitura.</p></div>
      {value&&value.quality.accepted&&(!value.quality.requiresConfirmation||value.qualityConfirmed)?<FileCheck2 className="h-5 w-5 shrink-0 text-primary" aria-label="Canhoto válido"/>:null}</div>

    {cameraOpen?<div className="space-y-2"><div className="relative overflow-hidden rounded border bg-black">
      <video ref={videoRef} playsInline muted className="block max-h-[60vh] w-full" aria-label="Prévia da câmera"/>
      {liveCorners?<svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon
        points={cornerKeys.map(key=>`${liveCorners[key].x*100},${liveCorners[key].y*100}`).join(' ')} fill="rgba(59,130,246,.12)" stroke="white" strokeWidth=".8"/></svg>:null}
      <div className="pointer-events-none absolute inset-x-5 inset-y-8 rounded border-2 border-dashed border-white/80"/></div>
      <p role="status" className="text-center text-xs">Mantenha o papel imóvel. A captura será automática quando as bordas estabilizarem.</p>
      <div className="grid grid-cols-2 gap-2"><Button type="button" onClick={()=>void captureLive()} disabled={busy}>Capturar agora</Button><Button type="button" variant="outline" onClick={stopCamera}><X className="mr-2 h-4 w-4"/>Cancelar</Button></div></div>:null}

    {!cameraOpen&&editing&&value&&sourcePreview?<div className="space-y-2"><p className="text-xs">Arraste os quatro cantos até coincidirem com o papel.</p>
      <div className="relative mx-auto w-fit max-w-full touch-none overflow-hidden rounded border bg-muted"><img src={sourcePreview} alt="Foto original para ajustar as bordas" className="block max-h-[60vh] max-w-full"/>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon
          points={cornerKeys.map(key=>`${corners[key].x*100},${corners[key].y*100}`).join(' ')} fill="rgba(59,130,246,.12)" stroke="hsl(var(--primary))" strokeWidth=".8"/></svg>
        {cornerKeys.map(key=><button key={key} type="button" aria-label={cornerLabels[key]} className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-primary shadow"
          style={{left:`${corners[key].x*100}%`,top:`${corners[key].y*100}%`}}
          onPointerDown={event=>event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
            const rect=event.currentTarget.parentElement!.getBoundingClientRect();setCorner(key,{x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))});}}/>)}
      </div><div className="grid grid-cols-2 gap-2"><Button type="button" disabled={busy} onClick={()=>void scan(value.original,corners,value.rotation??0)}><Check className="mr-2 h-4 w-4"/>Aplicar cantos</Button>
        <Button type="button" variant="outline" onClick={()=>setEditing(false)}>Cancelar ajuste</Button></div></div>:null}

    {!cameraOpen&&!editing&&preview?<img src={preview} alt="Canhoto recortado" className="max-h-64 w-full rounded border bg-muted object-contain"/>:null}
    {value&&value.quality.warnings.length?<div role="alert" className={`rounded p-2 text-xs ${value.quality.accepted?'bg-warning/10 text-warning-foreground':'bg-destructive/10 text-destructive'}`}>
      {value.quality.warnings.map(warning=><p key={warning}>{warning}</p>)}</div>:null}
    {value?.quality.accepted&&value.quality.requiresConfirmation&&!value.qualityConfirmed?<Button type="button" variant="outline" className="w-full" onClick={()=>onChange(confirmReceiptScanQuality(value))}>
      <Check className="mr-2 h-4 w-4"/>Li o canhoto e confirmo que está legível</Button>:null}
    {value?<p className="text-[11px] text-muted-foreground">Original preservado · scan {value.quality.processedWidth}×{value.quality.processedHeight} · ~{value.quality.estimatedDpi??0} DPI · {value.quality.processingMs??0} ms</p>:null}
    <p className="text-[11px] text-muted-foreground" data-testid="receipt-quality-policy">
      {policyLabels[value?.qualityPolicy?.source??qualityPolicy.source]} · versão {value?.qualityPolicy?.version??qualityPolicy.version}
    </p>

    {!cameraOpen?<div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>void startCamera()}><Camera className="mr-2 h-4 w-4"/>{value?'Refazer':'Abrir scanner'}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>galleryRef.current?.click()}><ImageIcon className="mr-2 h-4 w-4"/>Galeria</Button>
      {value?<Button type="button" variant="ghost" disabled={busy} onClick={()=>setEditing(current=>!current)}><Crop className="mr-2 h-4 w-4"/>Ajustar cantos</Button>:null}
      {value?<Button type="button" variant="ghost" disabled={busy} onClick={()=>void scan(value.original,value.corners??corners,rotation)}><RotateCw className="mr-2 h-4 w-4"/>Girar 90°</Button>:null}</div>:null}
    {busy?<p role="status" className="text-xs text-muted-foreground">Corrigindo perspectiva e verificando o canhoto…</p>:null}
    <input ref={cameraInputRef} aria-label="Fotografar canhoto pela câmera nativa" type="file" accept="image/*" capture="environment" className="hidden" onChange={select}/>
    <input ref={galleryRef} aria-label="Selecionar foto do canhoto" type="file" accept="image/*" className="hidden" onChange={select}/>
  </section>;
}
