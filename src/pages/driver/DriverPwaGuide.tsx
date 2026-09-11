import {useEffect,useState} from 'react';
import {CheckCircle2,Download,HardDrive,RefreshCw,Share2,Smartphone} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {readDriverBuildInfo,type DriverBuildInfo} from '@/lib/driver/driverAppObservability';

interface DeviceStatus{standalone:boolean;controlled:boolean;persisted:boolean|null;usage:number|null;quota:number|null;build:DriverBuildInfo|null}
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
const size=(bytes:number|null)=>bytes===null?'indisponível':`${(bytes/1024/1024).toFixed(1)} MB`;

export default function DriverPwaGuide(){
 const [status,setStatus]=useState<DeviceStatus|null>(null),[message,setMessage]=useState<string|null>(null);
 const inspect=async()=>{
  const [persisted,estimate,build]=await Promise.all([
   navigator.storage?.persisted?.().catch(()=>null)??Promise.resolve(null),
   navigator.storage?.estimate?.().catch(()=>({usage:undefined,quota:undefined}))??Promise.resolve({usage:undefined,quota:undefined}),
   readDriverBuildInfo(),
  ]);
  setStatus({standalone:standalone(),controlled:!!navigator.serviceWorker?.controller,persisted,
   usage:typeof estimate.usage==='number'?estimate.usage:null,quota:typeof estimate.quota==='number'?estimate.quota:null,build});
 };
 useEffect(()=>{void inspect();},[]);
 const requestPersistence=async()=>{const granted=await navigator.storage?.persist?.().catch(()=>false);setMessage(granted?'Armazenamento persistente autorizado.':'O aparelho não concedeu armazenamento persistente. Evite limpar os dados do navegador.');await inspect();};

 return <div className="space-y-4"><div><h1 className="text-lg font-bold">Instalar e usar offline</h1><p className="text-xs text-muted-foreground">Prepare este aparelho antes de iniciar uma viagem.</p></div>
  <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Smartphone className="h-4 w-4"/>Estado deste aparelho</CardTitle></CardHeader>
   <CardContent className="space-y-2 text-xs"><p>{status?.standalone?'✓ App aberto pela tela inicial':'○ App aberto no navegador'}</p><p>{status?.controlled?'✓ Conteúdo offline ativo':'○ Conteúdo offline ainda não controlado'}</p>
    <p>{status?.persisted?'✓ Armazenamento protegido contra limpeza automática':'○ Armazenamento persistente ainda não autorizado'}</p><p>Uso local: {size(status?.usage??null)} de {size(status?.quota??null)}</p>
    <p>Versão: {status?.build?.version??'indisponível'}{status?.build?.builtAt?` · ${new Date(status.build.builtAt).toLocaleString('pt-BR')}`:''}</p>
    <p>Hash do build: <code>{status?.build?.buildHash??'indisponível'}</code></p>
    <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={()=>void requestPersistence()}><HardDrive className="mr-2 h-4 w-4"/>Proteger dados</Button>
     <Button type="button" variant="outline" onClick={()=>void inspect()}><RefreshCw className="mr-2 h-4 w-4"/>Verificar</Button></div>{message?<p role="status">{message}</p>:null}</CardContent></Card>
  <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Download className="h-4 w-4"/>Android · Chrome</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
   <p>1. Abra o menu ⋮ do Chrome.</p><p>2. Toque em “Instalar app” ou “Adicionar à tela inicial”.</p><p>3. Confirme e abra o ícone AGVLog.</p><p>4. Entre na sua conta e abra a viagem ainda com internet para baixar os dados.</p></CardContent></Card>
  <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Share2 className="h-4 w-4"/>iPhone · Safari</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
   <p>1. Abra esta página no Safari.</p><p>2. Toque em Compartilhar.</p><p>3. Escolha “Adicionar à Tela de Início”.</p><p>4. Abra o ícone AGVLog, entre e carregue a viagem antes de sair.</p></CardContent></Card>
  <Card><CardContent className="space-y-2 p-4 text-xs"><p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-primary"/>Teste antes da viagem</p>
   <p>Com internet, abra Carga, Paradas, Jornada e Checklist. Ative o modo avião, feche e reabra o app pelo ícone. Confira a rota e a tela Sincronização; depois reative a rede.</p></CardContent></Card>
 </div>;
}
