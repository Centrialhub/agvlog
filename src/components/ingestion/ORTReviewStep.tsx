import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle, Files, Package, ReceiptText, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface OrtReviewItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  weightKg?: number;
  volumeM3?: number;
  confidence?: number;
}

export interface OrtReviewDocument {
  invoiceNumber: string;
  issueDate: string;
  paymentTerms: string;
  billing: string;
  cargoDescription: string;
  emitterName: string;
  emitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientPhone: string;
  recipientCity: string;
  recipientState: string;
  recipientAddress: string;
  recipientAddressNumber: string;
  recipientZip: string;
  recipientNeighborhood: string;
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
  productSummary: string;
  items?: OrtReviewItem[];
  confidence: number;
  needsReview: boolean;
  fieldConfidences?: Record<string, number>;
  fileName: string;
  sourcePages?: string[];
  pageCount?: number;
  extractedPayload?: Record<string, unknown>;
  unifiedDocId?: string;
  mergedFrom?: number;
}

interface ORTReviewStepProps {
  docs: OrtReviewDocument[];
  onBack: () => void;
  onUpdate: (index: number, updates: Partial<OrtReviewDocument>) => void;
  onConfirm: () => void;
}

const REVIEW_THRESHOLD = 0.82;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export default function ORTReviewStep({ docs, onBack, onUpdate, onConfirm }: ORTReviewStepProps) {
  const fieldClass = (doc: OrtReviewDocument, field: keyof OrtReviewDocument, required = false) => {
    const confidence = doc.fieldConfidences?.[String(field)] ?? doc.confidence;
    const missing = required && !String(doc[field] ?? '').trim();
    return confidence < REVIEW_THRESHOLD || missing ? 'border-warning bg-warning/10 focus-visible:ring-warning' : '';
  };

  const lowConfidenceCount = docs.reduce((sum, doc) => sum + (doc.needsReview || doc.confidence < REVIEW_THRESHOLD ? 1 : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Revisão das ORTs</h2>
          <p className="text-xs text-muted-foreground">Confira cada documento NF-like lido pela IA antes de entrar na validação.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="outline" className="gap-1.5">
            <Files className="h-3.5 w-3.5" /> {docs.length} documento(s)
          </Badge>
          <Badge variant="outline" className={lowConfidenceCount > 0 ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'}>
            {lowConfidenceCount > 0 ? `${lowConfidenceCount} para revisar` : 'Leitura confiável'}
          </Badge>
        </div>
      </div>

      {docs.map((doc, index) => (
        <Card key={`${doc.fileName}-${index}`} className={doc.needsReview || doc.confidence < REVIEW_THRESHOLD ? 'border-warning/30' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                ORT {doc.invoiceNumber || index + 1}
                {(doc.pageCount || 0) > 1 && (
                  <Badge variant="outline" className="border-info/30 bg-info/10 text-info gap-1">
                    <Files className="h-3 w-3" /> {doc.pageCount} páginas unidas
                  </Badge>
                )}
                {(doc.mergedFrom || 0) > 1 && (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary gap-1">
                    <Users className="h-3 w-3" /> Unificado de {doc.mergedFrom} scans (mesmo cliente)
                  </Badge>
                )}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {doc.needsReview || doc.confidence < REVIEW_THRESHOLD ? <AlertTriangle className="h-3.5 w-3.5 text-warning" /> : <CheckCircle className="h-3.5 w-3.5 text-success" />}
                Confiança {Math.round((doc.confidence || 0) * 100)}% · {doc.fileName}
              </span>
            </CardTitle>
            {doc.sourcePages && doc.sourcePages.length > 1 && (
              <p className="text-[11px] text-muted-foreground">Páginas/scans: {doc.sourcePages.join(' · ')}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><Label className="text-xs">Nº ORT</Label><Input className={fieldClass(doc, 'invoiceNumber', true)} value={doc.invoiceNumber} onChange={e => onUpdate(index, { invoiceNumber: e.target.value })} /></div>
              <div><Label className="text-xs">Data</Label><Input type="date" className={fieldClass(doc, 'issueDate')} value={doc.issueDate} onChange={e => onUpdate(index, { issueDate: e.target.value })} /></div>
              <div><Label className="text-xs">Paletes</Label><Input type="number" className={fieldClass(doc, 'estimatedPallets')} value={doc.estimatedPallets} onChange={e => onUpdate(index, { estimatedPallets: Number(e.target.value) || 0 })} /></div>
              <div><Label className="text-xs">Peso kg</Label><Input type="number" className={fieldClass(doc, 'totalWeight')} value={doc.totalWeight} onChange={e => onUpdate(index, { totalWeight: Number(e.target.value) || 0 })} /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div><Label className="text-xs">Prazo de pagamento</Label><Input className={fieldClass(doc, 'paymentTerms')} value={doc.paymentTerms} onChange={e => onUpdate(index, { paymentTerms: e.target.value })} placeholder="Ex.: 30 DIAS" /></div>
              <div><Label className="text-xs">Cobrança</Label><Input className={fieldClass(doc, 'billing')} value={doc.billing} onChange={e => onUpdate(index, { billing: e.target.value })} placeholder="CIF / FOB / A pagar" /></div>
              <div><Label className="text-xs">Carga</Label><Input className={fieldClass(doc, 'cargoDescription')} value={doc.cargoDescription} onChange={e => onUpdate(index, { cargoDescription: e.target.value })} placeholder="Tipo / natureza" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div><Label className="text-xs">Destinatário</Label><Input className={fieldClass(doc, 'recipientName', true)} value={doc.recipientName} onChange={e => onUpdate(index, { recipientName: e.target.value })} /></div>
              <div><Label className="text-xs">CNPJ/CPF destinatário</Label><Input className={fieldClass(doc, 'recipientCnpj')} value={doc.recipientCnpj} onChange={e => onUpdate(index, { recipientCnpj: e.target.value })} /></div>
              <div><Label className="text-xs">Telefone</Label><Input className={fieldClass(doc, 'recipientPhone')} value={doc.recipientPhone} onChange={e => onUpdate(index, { recipientPhone: e.target.value })} placeholder="(00) 00000-0000" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_80px_120px_1fr]">
              <div><Label className="text-xs">Endereço</Label><Input className={fieldClass(doc, 'recipientAddress')} value={doc.recipientAddress} onChange={e => onUpdate(index, { recipientAddress: e.target.value })} /></div>
              <div><Label className="text-xs">Número</Label><Input className={fieldClass(doc, 'recipientAddressNumber')} value={doc.recipientAddressNumber} onChange={e => onUpdate(index, { recipientAddressNumber: e.target.value })} /></div>
              <div><Label className="text-xs">CEP</Label><Input className={fieldClass(doc, 'recipientZip')} value={doc.recipientZip} onChange={e => onUpdate(index, { recipientZip: e.target.value })} /></div>
              <div><Label className="text-xs">Bairro</Label><Input className={fieldClass(doc, 'recipientNeighborhood')} value={doc.recipientNeighborhood} onChange={e => onUpdate(index, { recipientNeighborhood: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><Label className="text-xs">Cidade</Label><Input className={fieldClass(doc, 'recipientCity', true)} value={doc.recipientCity} onChange={e => onUpdate(index, { recipientCity: e.target.value })} /></div>
              <div><Label className="text-xs">UF</Label><Input className={fieldClass(doc, 'recipientState', true)} value={doc.recipientState} onChange={e => onUpdate(index, { recipientState: e.target.value.toUpperCase().slice(0, 2) })} /></div>
              <div><Label className="text-xs">Remetente</Label><Input className={fieldClass(doc, 'emitterName')} value={doc.emitterName} onChange={e => onUpdate(index, { emitterName: e.target.value })} /></div>
              <div><Label className="text-xs">Valor</Label><Input type="number" className={fieldClass(doc, 'totalValue')} value={doc.totalValue} onChange={e => onUpdate(index, { totalValue: Number(e.target.value) || 0 })} /></div>
            </div>
            <div><Label className="text-xs">Mercadoria / observações</Label><Textarea className={fieldClass(doc, 'productSummary')} value={doc.productSummary} onChange={e => onUpdate(index, { productSummary: e.target.value })} /></div>
            {doc.items && doc.items.length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-xs">Itens identificados</Label>
                <div className="mt-2 space-y-2">
                  {doc.items.map((item, itemIndex) => (
                    <div key={`${item.description}-${itemIndex}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_90px_90px_120px]">
                      <Input value={item.description} onChange={e => onUpdate(index, { items: doc.items?.map((it, i) => i === itemIndex ? { ...it, description: e.target.value } : it) })} />
                      <Input type="number" value={item.quantity} onChange={e => onUpdate(index, { items: doc.items?.map((it, i) => i === itemIndex ? { ...it, quantity: Number(e.target.value) || 0 } : it) })} />
                      <Input value={item.unit} onChange={e => onUpdate(index, { items: doc.items?.map((it, i) => i === itemIndex ? { ...it, unit: e.target.value } : it) })} />
                      <Input type="number" value={item.totalPrice} onChange={e => onUpdate(index, { items: doc.items?.map((it, i) => i === itemIndex ? { ...it, totalPrice: Number(e.target.value) || 0 } : it) })} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ReceiptText className="h-4 w-4 text-primary" /> Resumo para confirmar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.map((doc, index) => (
            <div key={`summary-${doc.fileName}-${index}`} className="rounded-md border border-border bg-background/80 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-sm">ORT {doc.invoiceNumber || index + 1}</span>
                <Badge variant="outline">{currency.format(doc.totalValue || 0)}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground"><Users className="h-3.5 w-3.5 text-muted-foreground" /> Partes</div>
                  <p className="text-muted-foreground">Emitente: <span className="text-foreground">{doc.emitterName || '—'}</span></p>
                  <p className="text-muted-foreground">Destinatário: <span className="text-foreground">{doc.recipientName || '—'}</span></p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground"><ReceiptText className="h-3.5 w-3.5 text-muted-foreground" /> Valores</div>
                  <p className="text-muted-foreground">Peso: <span className="text-foreground">{number.format(doc.totalWeight || 0)} kg</span></p>
                  <p className="text-muted-foreground">Paletes: <span className="text-foreground">{number.format(doc.estimatedPallets || 0)}</span></p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground"><Package className="h-3.5 w-3.5 text-muted-foreground" /> Itens</div>
                  <p className="line-clamp-2 text-foreground">{doc.items?.length ? `${doc.items.length} item(ns): ${doc.items.map(item => item.description).join(', ')}` : (doc.productSummary || 'Mercadoria ORT')}</p>
                  <p className="text-muted-foreground">Destino: <span className="text-foreground">{[doc.recipientCity, doc.recipientState].filter(Boolean).join(' - ') || '—'}</span></p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
        <Button onClick={onConfirm}>Validar ORTs <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </div>
  );
}