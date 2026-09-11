import { AlertTriangle, Camera, FileSignature, ImageIcon, Phone, MessageSquare, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import DeliveryReceiptScanner from '@/components/driver/DeliveryReceiptScanner';
import SignaturePad from '@/components/driver/SignaturePad';
import { cn } from '@/lib/utils';
import { deliveryErrorMessage } from '@/lib/driver/driverDeliverySubmission';
import { isReceiptScanAcceptable } from '@/lib/driver/receiptScan';
import type { ReceiptScanQualityPolicy } from '@/lib/driver/receiptQualityPolicy';
import { isStopTerminal } from '@/lib/status/stopStatus';
import type { DriverDeliveryEventDraft } from '@/hooks/useDriverDeliveryEventDraft';
import { DriverDeliveryProductsField } from './DriverDeliveryProductsField';
import {
  getStopOrderNumber,
  type DeliveryEventSelection,
  type DriverStop,
  type EventDef,
  type StopProduct,
} from './driverDeliveryEvents';

type Notice = { title: string; description?: string; variant?: 'destructive' };

type Props = {
  selection: DeliveryEventSelection | null;
  definition: EventDef | null | undefined;
  draft: DriverDeliveryEventDraft;
  currentStop: DriverStop | undefined;
  allProducts: StopProduct[];
  products: StopProduct[];
  productsLoading: boolean;
  productsError: unknown;
  refetchProducts: () => unknown;
  totalReturnValue: number;
  totalReturnedQuantity: number;
  totalProductQuantity: number;
  mappedOutcome: string | undefined;
  reason: string;
  canSubmit: boolean;
  submissionLocked: boolean;
  submitting: boolean;
  receiptQualityPolicy: ReceiptScanQualityPolicy;
  receiptQualityPolicyLoading: boolean;
  receiptQualityPolicyError: unknown;
  refetchReceiptQualityPolicy: () => unknown;
  onClose: () => void;
  onSubmit: () => void;
  notify: (notice: Notice) => void;
};

export function DriverDeliveryEventFormSheet({
  selection,
  definition,
  draft,
  currentStop,
  allProducts,
  products,
  productsLoading,
  productsError,
  refetchProducts,
  totalReturnValue,
  totalReturnedQuantity,
  totalProductQuantity,
  mappedOutcome,
  reason,
  canSubmit,
  submissionLocked,
  submitting,
  receiptQualityPolicy,
  receiptQualityPolicyLoading,
  receiptQualityPolicyError,
  refetchReceiptQualityPolicy,
  onClose,
  onSubmit,
  notify,
}: Props) {
  const def = definition;
  return (
    <Sheet open={!!selection} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Dados do evento</SheetTitle>
        </SheetHeader>
        {def && selection && (
          <div className="space-y-4 mt-2">
            <div className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm font-medium flex items-center gap-2">
              <def.icon className="h-4 w-4" />
              Evento: <span className="font-bold">{def.label}</span>
            </div>

            <fieldset disabled={submitting || submissionLocked} className="space-y-4 disabled:opacity-70">
              <div className="rounded-md border border-border p-3 space-y-1 bg-muted/30">
                <p className="text-sm font-semibold">{selection.stop.clients?.company_name || 'Cliente'}</p>
                <p className="text-[11px] text-muted-foreground">{selection.stop.destination}</p>
                {getStopOrderNumber(selection.stop) && (
                  <Badge variant="outline" className="text-[10px]">Pedido {getStopOrderNumber(selection.stop)}</Badge>
                )}
              </div>

              {def.showsContact && selection.stop.clients && (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contato do cliente</p>
                  {selection.stop.clients.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <a href={`tel:${selection.stop.clients.phone}`} className="text-primary">{selection.stop.clients.phone}</a>
                    </div>
                  )}
                  {selection.stop.clients.mobile && (
                    <div className="flex items-center gap-2 text-sm">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <a target="_blank" rel="noreferrer" href={`https://wa.me/${selection.stop.clients.mobile}`} className="text-primary">WhatsApp</a>
                    </div>
                  )}
                  {selection.stop.clients.email && <div className="text-[11px] text-muted-foreground">{selection.stop.clients.email}</div>}
                </div>
              )}

              {def.key === 'atualizar_boleto' && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Atualização de boleto</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-boleto-due-date" className="text-xs">Novo vencimento sugerido</Label>
                    <Input id="delivery-boleto-due-date" type="date" value={draft.boletoDueDate} onChange={(event) => draft.setBoletoDueDate(event.target.value)} className="h-10 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-boleto-note" className="text-xs">Detalhe / motivo</Label>
                    <Textarea id="delivery-boleto-note" rows={2} value={draft.boletoNote} onChange={(event) => draft.setBoletoNote(event.target.value)} placeholder="Ex.: cliente pediu prorrogar 3 dias úteis" className="text-sm" />
                  </div>
                </div>
              )}

              {def.showsDiscount && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Solicitar desconto</p>
                  <div role="group" aria-label="Tipo do desconto" className="grid grid-cols-3 gap-2">
                    <button type="button" aria-label="Desconto em porcentagem" aria-pressed={draft.discountKind === 'percent'} onClick={() => draft.setDiscountKind('percent')} className={cn('text-xs h-9 rounded-md border', draft.discountKind === 'percent' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>%</button>
                    <button type="button" aria-label="Desconto em reais" aria-pressed={draft.discountKind === 'value'} onClick={() => draft.setDiscountKind('value')} className={cn('text-xs h-9 rounded-md border', draft.discountKind === 'value' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>R$</button>
                    <Label htmlFor="delivery-discount-amount" className="sr-only">Valor do desconto</Label>
                    <Input id="delivery-discount-amount" value={draft.discountAmount} onChange={(event) => draft.setDiscountAmount(event.target.value.replace(',', '.'))} inputMode="decimal" placeholder={draft.discountKind === 'percent' ? '5' : '50,00'} className="h-9 text-sm" />
                  </div>
                  <Label htmlFor="delivery-discount-reason" className="sr-only">Justificativa do desconto</Label>
                  <Textarea id="delivery-discount-reason" rows={2} value={draft.discountReason} onChange={(event) => draft.setDiscountReason(event.target.value)} placeholder="Justificativa (obrigatório)" className="text-sm" />
                </div>
              )}

              <DriverDeliveryProductsField
                definition={def}
                allProducts={allProducts}
                products={products}
                draft={draft}
                totalReturnedQuantity={totalReturnedQuantity}
                totalReturnValue={totalReturnValue}
              />

              <div className="space-y-1.5">
                <Label htmlFor="delivery-receiver" className="text-xs font-medium">Recebedor {def.requiresReceiver && <span className="text-destructive">*</span>}</Label>
                <Input id="delivery-receiver" placeholder="Digite o nome aqui" value={draft.receiverName} onChange={(event) => draft.setReceiverName(event.target.value)} className="text-sm h-10" maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery-document" className="text-xs font-medium">Número do documento</Label>
                <Input id="delivery-document" placeholder="RG/CPF" value={draft.receiverDoc} onChange={(event) => draft.setReceiverDoc(event.target.value)} className="text-sm h-10" inputMode="numeric" maxLength={20} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delivery-notes" className="text-xs font-medium">Observações</Label>
                <Textarea id="delivery-notes" placeholder="Observações" rows={3} value={draft.notes} onChange={(event) => draft.setNotes(event.target.value)} className="text-sm" maxLength={500} />
              </div>

              {def.requiresReceipt && (
                receiptQualityPolicyLoading ? <p role="status" className="text-xs text-muted-foreground">Carregando a regra de qualidade desta entrega…</p>
                : receiptQualityPolicyError ? <div role="alert" className="space-y-2 text-sm text-destructive">
                  <p>Não foi possível validar a regra de qualidade desta entrega.</p>
                  <Button type="button" variant="outline" onClick={() => void refetchReceiptQualityPolicy()}>Tentar novamente</Button>
                </div>
                : <DeliveryReceiptScanner
                  value={draft.receiptScan}
                  qualityPolicy={receiptQualityPolicy}
                  onChange={draft.setReceiptScan}
                  onError={(message) => notify({ title: 'Canhoto inválido', description: message, variant: 'destructive' })}
                />
              )}

              {draft.photoPreviews.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Fotos adicionais <span className="text-muted-foreground font-normal">({draft.photos.length}/{def.requiresReceipt ? 4 : 5})</span></p>
                  <div className="grid grid-cols-3 gap-2">
                    {draft.photoPreviews.map((url, index) => (
                      <div key={url} className="relative aspect-square rounded-md overflow-hidden border border-border">
                        <img src={url} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" />
                        <button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => draft.removePhoto(index)} className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {def.requiresSignature && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Assinatura <span className="text-destructive">*</span></p>
                  <SignaturePad onChange={draft.setSignatureDataUrl} />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  icon={FileSignature}
                  label="Assinatura"
                  active={!!draft.signatureDataUrl}
                  onClick={() => {
                    if (!def.requiresSignature) notify({ title: 'Assinatura opcional', description: 'Use o quadro abaixo para assinar.' });
                    document.getElementById('sig-anchor')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
                <ActionButton icon={Camera} label="Câmera" active={draft.photos.length > 0} onClick={() => draft.cameraInputRef.current?.click()} />
                <ActionButton icon={ImageIcon} label="Galeria" active={draft.photos.length > 0} onClick={() => draft.galleryInputRef.current?.click()} />
              </div>

              <input ref={draft.cameraInputRef} aria-label="Capturar foto da entrega" type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => draft.selectPhotos(event, selection.eventKey, (message) => notify({ title: 'Foto inválida', description: message, variant: 'destructive' }))} />
              <input ref={draft.galleryInputRef} aria-label="Selecionar fotos da entrega" type="file" accept="image/*" multiple className="hidden" onChange={(event) => draft.selectPhotos(event, selection.eventKey, (message) => notify({ title: 'Foto inválida', description: message, variant: 'destructive' }))} />
              <div id="sig-anchor" />
            </fieldset>

            {submissionLocked && <p role="status" className="text-sm">Os dados deste envio foram preservados. Tentar novamente usa os mesmos anexos e identificador.</p>}
            {def.showsItems && productsLoading && <p role="status">Carregando itens desta tentativa…</p>}
            {productsError != null && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{deliveryErrorMessage(productsError)}</p>
                <Button variant="outline" type="button" onClick={() => void refetchProducts()}>Recarregar itens</Button>
              </div>
            )}
            {!submissionLocked && (!currentStop || isStopTerminal(currentStop.status)) && <p role="alert" className="text-sm">A parada foi encerrada ou reatribuída. Os campos preenchidos foram preservados.</p>}
            {mappedOutcome && currentStop && !currentStop.actual_arrival_at && <p role="alert" className="text-sm">Registre a chegada antes do resultado da entrega.</p>}
            {mappedOutcome === 'partial_delivery' && !(totalReturnedQuantity > 0 && totalReturnedQuantity < totalProductQuantity) && <p role="alert" className="text-sm">Na entrega parcial, devolva uma quantidade maior que zero e menor que o total.</p>}
            {def.key !== 'entregue' && def.key !== 'chegada_no_cliente' && reason.length < 3 && <p className="text-sm">Informe um motivo ou descrição com pelo menos três caracteres.</p>}

            {!canSubmit && (
              <div className="bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
                {def.requiresReceiver && draft.receiverName.trim().length < 2 && <ValidationHint>Informe o nome do recebedor</ValidationHint>}
                {def.requiresPhoto && draft.photos.length === 0 && <ValidationHint>Adicione pelo menos 1 foto</ValidationHint>}
                {def.requiresReceipt && !isReceiptScanAcceptable(draft.receiptScan) && <ValidationHint>Digitalize um canhoto legível</ValidationHint>}
                {def.requiresReceipt && receiptQualityPolicyLoading && <ValidationHint>Aguarde a regra de qualidade da entrega</ValidationHint>}
                {def.requiresSignature && !draft.signatureDataUrl && <ValidationHint>Capture a assinatura</ValidationHint>}
              </div>
            )}

            <Button size="lg" className="w-full" onClick={onSubmit} disabled={(!canSubmit && !submissionLocked) || submitting}>
              {submitting ? 'Enviando...' : submissionLocked ? 'Tentar novamente o mesmo envio' : 'Lançar evento'}
            </Button>
            <p className="text-xs text-muted-foreground">Solicitações são registradas para análise da operação. O envio não representa aprovação.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ValidationHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> {children}</p>;
}

function ActionButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(
      'flex flex-col items-center justify-center gap-1.5 py-3 rounded-md border transition-colors min-h-16',
      active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-accent active:bg-accent/70 text-foreground',
    )}>
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
