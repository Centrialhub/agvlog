import type {ReceiptRecognitionReading} from '@/lib/deliveryReceipts/receiptRecognition';
const signatureLabels={present:'Assinatura visível no canhoto',absent:'Assinatura não encontrada no canhoto',uncertain:'Assinatura inconclusiva'};
export function ReceiptRecognitionPanel({reading,error,loading}:{reading?:ReceiptRecognitionReading;error:boolean;loading:boolean}){
 if(error)return <p role="alert" className="text-xs text-amber-700">A leitura automática não pôde ser consultada. Atualize a página para tentar novamente.</p>;
 if(loading&&!reading)return <p role="status" className="text-xs text-muted-foreground">Consultando leitura do canhoto…</p>;
 if(!reading||reading.status==='not_requested')return <p className="text-xs text-muted-foreground">Leitura automática aguardando envio do canhoto.</p>;
 if(['queued','processing'].includes(reading.status))return <p role="status" className="text-xs text-muted-foreground">{reading.status==='queued'?'Canhoto na fila de leitura automática.':'Lendo a escrita e identificando assinatura no canhoto…'}</p>;
 if(reading.status!=='completed')return <p role="status" className="text-xs text-amber-700">{reading.error_code==='ocr_provider_credits_exhausted'
  ?'Leitura aguardando disponibilidade de créditos do serviço de IA.':'Leitura automática indisponível para este arquivo. Confira a imagem do canhoto.'}</p>;
 const date=reading.delivery_date?.split('-').reverse().join('/');
 return <section className="space-y-1 rounded-md border p-2 text-xs" aria-label="Leitura automática do canhoto">
  <p><strong>Data escrita no canhoto:</strong> {date||'Não identificada com segurança'}{!date&&reading.date_text?` · texto lido: ${reading.date_text}`:''}</p>
  <p>{reading.signature_presence?signatureLabels[reading.signature_presence]:'Presença de assinatura não identificada'}</p>
  {reading.needs_review?<p className="text-amber-700">Confira a imagem: esta leitura precisa de revisão.</p>:null}
  <p className="text-muted-foreground">A data lida é separada do horário da baixa. Identificar um traço de assinatura não autentica o signatário.</p>
  {reading.text?<details><summary className="cursor-pointer">Ver texto identificado</summary><p className="whitespace-pre-wrap break-words">{reading.text}</p></details>:null}
 </section>;
}
