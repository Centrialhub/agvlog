import { useEffect, useState } from 'react';
import { Download, RefreshCw, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InstallPromptEvent extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}

const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator&{standalone?:boolean}).standalone===true;
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);

export function DriverPwaInstall(){
  const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
  const [installed,setInstalled]=useState(()=>typeof window!=='undefined'&&isStandalone());
  const [dismissed,setDismissed]=useState(false);
  const [update,setUpdate]=useState<ServiceWorkerRegistration|null>(null);

  useEffect(()=>{
    const before=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent);setDismissed(false);};
    const complete=()=>{setInstalled(true);setPrompt(null);};
    const available=(event:Event)=>setUpdate((event as CustomEvent<{registration:ServiceWorkerRegistration}>).detail.registration);
    const reload=()=>window.location.reload();
    window.addEventListener('beforeinstallprompt',before);
    window.addEventListener('appinstalled',complete);
    window.addEventListener('agvlog:pwa-update',available);
    navigator.serviceWorker?.addEventListener('controllerchange',reload);
    return()=>{window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',complete);
      window.removeEventListener('agvlog:pwa-update',available);navigator.serviceWorker?.removeEventListener('controllerchange',reload);};
  },[]);

  if(update?.waiting)return <div role="status" className="flex items-center justify-between gap-2 bg-info/15 px-4 py-2 text-xs">
    <span>Atualização do app disponível.</span><Button size="sm" variant="outline" onClick={()=>update.waiting?.postMessage({type:'ACTIVATE_UPDATE'})}>
      <RefreshCw className="mr-1 h-4 w-4"/>Atualizar</Button></div>;
  if(installed||dismissed||(!prompt&&!isIos()))return null;

  return <div className="flex items-center gap-2 bg-primary/10 px-4 py-2 text-xs text-primary">
    {isIos()&&!prompt?<><Share2 className="h-4 w-4 shrink-0"/><span className="flex-1">No Safari, toque em Compartilhar e “Adicionar à Tela de Início”.</span></>:
      <><Download className="h-4 w-4 shrink-0"/><span className="flex-1">Instale o app para abrir rapidamente e usar a rota sem sinal.</span>
        <Button size="sm" onClick={async()=>{await prompt?.prompt();const choice=await prompt?.userChoice;if(choice?.outcome==='accepted')setInstalled(true);setPrompt(null);}}>Instalar app</Button></>}
    <button type="button" className="p-2" aria-label="Fechar aviso de instalação" onClick={()=>setDismissed(true)}><X className="h-4 w-4"/></button>
  </div>;
}
