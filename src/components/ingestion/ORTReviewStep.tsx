import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface OrtReviewDocument {
  invoiceNumber: string;
  issueDate: string;
  emitterName: string;
  emitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientCity: string;
  recipientState: string;
  recipientAddress: string;
  recipientNeighborhood: string;
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
  productSummary: string;
  confidence: number;
  needsReview: boolean;
  fieldConfidences?: Record<string, number>;
  fileName: string;
}

interface ORTReviewStepProps {
  docs: OrtReviewDocument[];
  onBack: () => void;
  onUpdate: (index: number, updates: Partial<OrtReviewDocument>) => void;
  onConfirm: () => void;
}

const REVIEW_THRESHOLD = 0.82;

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
          <h2 className="text-lg font-semibold">Revisão da ORT</h2>
          <p className="text-xs text-muted-foreground">Confira os campos lidos pela IA antes de entrar na validação.</p>
        </div>
        <Badge variant="outline" className={lowConfidenceCount > 0 ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'}>
          {lowConfidenceCount > 0 ? `${lowConfidenceCount} para revisar` : 'Leitura confiável'}
        </Badge>
      </div>

      {docs.map((doc, index) => (
        <Card key={`${doc.fileName}-${index}`} className={doc.needsReview || doc.confidence < REVIEW_THRESHOLD ? 'border-warning/30' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-sm">
              <span>ORT {doc.invoiceNumber || index + 1}</span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {doc.needsReview || doc.confidence < REVIEW_THRESHOLD ? <AlertTriangle className="h-3.5 w-3.5 text-warning" /> : <CheckCircle className="h-3.5 w-3.5 text-success" />}
                Confiança {Math.round((doc.confidence || 0) * 100)}% · {doc.fileName}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><Label className="text-xs">Nº ORT</Label><Input className={fieldClass(doc, 'invoiceNumber', true)} value={doc.invoiceNumber} onChange={e => onUpdate(index, { invoiceNumber: e.target.value })} /></div>
              <div><Label className="text-xs">Data</Label><Input type="date" className={fieldClass(doc, 'issueDate')} value={doc.issueDate} onChange={e => onUpdate(index, { issueDate: e.target.value })} /></div>
              <div><Label className="text-xs">Paletes</Label><Input type="number" className={fieldClass(doc, 'estimatedPallets')} value={doc.estimatedPallets} onChange={e => onUpdate(index, { estimatedPallets: Number(e.target.value) || 0 })} /></div>
              <div><Label className="text-xs">Peso kg</Label><Input type="number" className={fieldClass(doc, 'totalWeight')} value={doc.totalWeight} onChange={e => onUpdate(index, { totalWeight: Number(e.target.value) || 0 })} /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div><Label className="text-xs">Destinatário</Label><Input className={fieldClass(doc, 'recipientName', true)} value={doc.recipientName} onChange={e => onUpdate(index, { recipientName: e.target.value })} /></div>
              <div><Label className="text-xs">CNPJ/CPF destinatário</Label><Input className={fieldClass(doc, 'recipientCnpj')} value={doc.recipientCnpj} onChange={e => onUpdate(index, { recipientCnpj: e.target.value })} /></div>
              <div><Label className="text-xs">Remetente</Label><Input className={fieldClass(doc, 'emitterName')} value={doc.emitterName} onChange={e => onUpdate(index, { emitterName: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><Label className="text-xs">Cidade</Label><Input className={fieldClass(doc, 'recipientCity', true)} value={doc.recipientCity} onChange={e => onUpdate(index, { recipientCity: e.target.value })} /></div>
              <div><Label className="text-xs">UF</Label><Input className={fieldClass(doc, 'recipientState', true)} value={doc.recipientState} onChange={e => onUpdate(index, { recipientState: e.target.value.toUpperCase().slice(0, 2) })} /></div>
              <div><Label className="text-xs">Bairro</Label><Input className={fieldClass(doc, 'recipientNeighborhood')} value={doc.recipientNeighborhood} onChange={e => onUpdate(index, { recipientNeighborhood: e.target.value })} /></div>
              <div><Label className="text-xs">Valor</Label><Input type="number" className={fieldClass(doc, 'totalValue')} value={doc.totalValue} onChange={e => onUpdate(index, { totalValue: Number(e.target.value) || 0 })} /></div>
            </div>
            <div><Label className="text-xs">Mercadoria / observações</Label><Textarea className={fieldClass(doc, 'productSummary')} value={doc.productSummary} onChange={e => onUpdate(index, { productSummary: e.target.value })} /></div>
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
        <Button onClick={onConfirm}>Validar ORT <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </div>
  );
}