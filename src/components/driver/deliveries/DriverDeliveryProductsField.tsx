import { CheckCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { DriverDeliveryEventDraft } from '@/hooks/useDriverDeliveryEventDraft';
import type { EventDef, StopProduct } from './driverDeliveryEvents';

type Props = {
  definition: EventDef;
  allProducts: StopProduct[];
  products: StopProduct[];
  draft: DriverDeliveryEventDraft;
  totalReturnedQuantity: number;
  totalReturnValue: number;
};

export function DriverDeliveryProductsField({
  definition,
  allProducts,
  products,
  draft,
  totalReturnedQuantity,
  totalReturnValue,
}: Props) {
  if (!definition.showsItems) return null;
  return (
    <>
      {definition.category === 'finalizador' && allProducts.length > products.length && (
        <p role="status" className="text-sm text-muted-foreground">
          Notas já concluídas foram preservadas. A devolução considera somente os itens restantes desta parada.
        </p>
      )}
      {products.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Produtos do cliente ({products.length})</p>
            <button
              type="button"
              onClick={() => draft.setReturnedItems(Object.fromEntries(products.map((product) => [product.id, product.qty])))}
              className="text-[10px] text-primary"
            >
              Marcar tudo
            </button>
          </div>
          <div className="space-y-2">
            {products.map((product) => {
              const quantity = draft.returnedItems[product.id] || 0;
              const checked = quantity > 0;
              return (
                <div key={product.id} className={cn('rounded-md border p-2 space-y-1.5', checked ? 'border-primary bg-primary/5' : 'border-border')}>
                  <button
                    type="button"
                    onClick={() => draft.setReturnedItems((previous) => {
                      const next = { ...previous };
                      if (next[product.id]) delete next[product.id];
                      else next[product.id] = product.qty;
                      return next;
                    })}
                    className="w-full flex items-start gap-2 text-left"
                  >
                    <div className={cn('mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>
                      {checked && <CheckCircle className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{product.name}</p>
                      <p className="text-[10px] text-muted-foreground">SKU {product.sku} · {product.qty} {product.unit} · R$ {product.price.toFixed(2)}</p>
                    </div>
                  </button>
                  {checked && (
                    <div className="flex items-center gap-2 pl-6">
                      <Label htmlFor={`delivery-return-quantity-${product.id}`} className="text-[10px] text-muted-foreground">Devolver:</Label>
                      <Input
                        id={`delivery-return-quantity-${product.id}`}
                        type="number"
                        aria-label={`Quantidade devolvida de ${product.name}`}
                        min={0}
                        step="any"
                        max={product.qty}
                        value={quantity}
                        onChange={(event) => {
                          const value = Math.min(product.qty, Math.max(0, Number(event.target.value || '0')));
                          draft.setReturnedItems((previous) => ({ ...previous, [product.id]: value }));
                        }}
                        className="h-7 text-xs w-20"
                      />
                      <span className="text-[10px] text-muted-foreground">/ {product.qty} {product.unit}</span>
                      <span className="ml-auto text-[10px] font-semibold">R$ {(quantity * product.price).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {totalReturnedQuantity > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-border text-xs">
              <span className="text-muted-foreground">Total devolução</span>
              <span className="font-semibold">R$ {totalReturnValue.toFixed(2)}</span>
            </div>
          )}
          <Textarea rows={2} value={draft.returnReason} onChange={(event) => draft.setReturnReason(event.target.value)} aria-label="Motivo da devolução" placeholder="Motivo da devolução (avaria, validade, divergência...)" className="text-sm" />
        </div>
      )}
    </>
  );
}
