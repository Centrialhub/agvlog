import { z } from 'zod';
import { parseFinanceAmount } from './ledgerContract';

export const expenseCategories = { fuel: 'Combustível', food: 'Alimentação', unloading: 'Descarga', toll: 'Pedágio',
  lodging: 'Hospedagem', maintenance: 'Manutenção', office: 'Sede / escritório', cleaning: 'Limpeza', payroll: 'Folha',
  tax: 'Tributos', rent: 'Aluguel', utility: 'Água / energia / telefone', service: 'Serviços', other: 'Outros' } as const;
const uuid = z.string().uuid();
export const financeOptionSchema = z.object({ id: uuid, label: z.string(), driver_id: uuid.nullable().optional(),
  amount_cents: z.number().int().positive().max(99999999999999).optional(),
  remaining_cents: z.number().int().nonnegative().max(99999999999999).optional(),
  delivery: z.object({ revision: z.string(), issue: z.string().nullable(), supplier_id: uuid.nullable(),
    supplier_name: z.string().nullable(), delivery_stop_id: uuid.nullable(), trip_id: uuid }).optional(),
});
export type FinanceOption = z.infer<typeof financeOptionSchema>;
export type ExpenseOptionKind = 'trips' | 'movements' | 'suppliers' | 'centers' | 'deliveries';
export const expenseOptionsSchema = z.object({ version: z.literal(1), tenant_id: uuid, kind: z.string(), trip_id: uuid.nullable(),
  page: z.number().int().positive(), total: z.number().int().nonnegative(), rows: z.array(financeOptionSchema) });
export const expenseLineDraftSchema = z.object({ id: uuid, category: z.enum(Object.keys(expenseCategories) as [keyof typeof expenseCategories, ...Array<keyof typeof expenseCategories>]),
  description: z.string(), amount: z.string(), date: z.string(), supplier: financeOptionSchema.nullable(), supplierName: z.string(),
  center: financeOptionSchema.nullable(), document: z.string(), receiptPath: z.string(), receiptName: z.string(), noReceiptReason: z.string(),
  dueDate: z.string(), payeeType: z.enum(['driver', 'supplier']), delivery: financeOptionSchema.nullable(),
  allocations: z.array(z.object({ movement: financeOptionSchema, amount: z.string() })),
});
export type ExpenseLineDraft = z.infer<typeof expenseLineDraftSchema>;
export const expenseBatchDraftSchema = z.object({ context: z.enum(['trip','office','personnel','maintenance','other']),
  trip: financeOptionSchema.nullable(), description: z.string(), reason: z.string(), lines: z.array(expenseLineDraftSchema) });
export type ExpenseBatchDraft = z.infer<typeof expenseBatchDraftSchema>;
export function distributeExpenseMovement(draft: ExpenseBatchDraft, movement: FinanceOption): ExpenseBatchDraft {
  if (movement.remaining_cents === undefined) throw new Error('Atualize o saldo disponível do envio.');
  if (movement.driver_id && (draft.context !== 'trip' || draft.trip?.driver_id !== movement.driver_id)) throw new Error('O envio pertence a outro motorista.');
  let available = BigInt(movement.remaining_cents) - draft.lines.reduce((sum,line) => sum + line.allocations
    .filter(a => a.movement.id === movement.id).reduce((s,a) => s+BigInt(parseFinanceAmount(a.amount)||0),0n),0n);
  if (available < 0n) throw new Error('Os vínculos existentes excedem o saldo disponível.');
  const money = (cents: bigint) => `${cents/100n},${String(cents%100n).padStart(2,'0')}`;
  return {...draft,lines:draft.lines.map(line => {
    const allocated = line.allocations.reduce((sum,a) => sum+BigInt(parseFinanceAmount(a.amount)||0),0n);
    const remaining = BigInt(parseFinanceAmount(line.amount)||0)-allocated;
    if (remaining<=0n || available<=0n) return line;
    const portion = remaining<available?remaining:available; available-=portion;
    const found = line.allocations.find(a=>a.movement.id===movement.id);
    return {...line,allocations:found ? line.allocations.map(a=>a.movement.id===movement.id
      ? {movement,amount:money(BigInt(parseFinanceAmount(a.amount)||0)+portion)} : a)
      : [...line.allocations,{movement,amount:money(portion)}]};
  })};
}
export function newExpenseLine(context: ExpenseBatchDraft['context']): ExpenseLineDraft {
  const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return { id: crypto.randomUUID(), category: context === 'trip' ? 'fuel' : context === 'personnel' ? 'payroll' : 'office',
    description: '', amount: '', date: date.toISOString().slice(0,10), supplier: null, supplierName: '', center: null,
    document: '', receiptPath: '', receiptName: '', noReceiptReason: '', dueDate: '', payeeType: context === 'trip' ? 'driver' : 'supplier',
    delivery: null, allocations: [] };
}
export function buildExpenseBatch(draft: ExpenseBatchDraft, tenant: string, request: string) {
  if (!draft.description.trim() || draft.reason.trim().length < 5 || !draft.lines.length || draft.lines.length > 200
    || (draft.context === 'trip' && !draft.trip)) throw new Error('Informe contexto, descrição, motivo e pelo menos um gasto.');
  const used = new Map<string,bigint>();
  const items = draft.lines.map((line,index) => {
    const fail = (message: string): never => { throw new Error(`Gasto ${index+1}: ${message}`); };
    const cents = parseFinanceAmount(line.amount);
    if (!cents || !line.description.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(line.date)) fail('informe valor, descrição e data.');
    if (!line.receiptPath && line.noReceiptReason.trim().length < 5) fail('anexe o comprovante ou justifique sua ausência.');
    if (line.receiptPath && !line.receiptPath.startsWith(`${tenant}/`)) fail('comprovante pertence a outra empresa.');
    if (!line.supplier && !line.supplierName.trim()) fail('informe quem forneceu o produto ou serviço.');
    const seen = new Set<string>();
    const allocations = line.allocations.map(a => {
      const amount = parseFinanceAmount(a.amount);
      if (!amount || seen.has(a.movement.id)) return fail('vínculo de envio inválido ou repetido.');
      if (a.movement.driver_id && (draft.context !== 'trip' || a.movement.driver_id !== draft.trip?.driver_id)) fail('envio pertence a outro motorista.');
      seen.add(a.movement.id);
      const sum = (used.get(a.movement.id) ?? 0n) + BigInt(amount);
      if (a.movement.remaining_cents === undefined || sum > BigInt(a.movement.remaining_cents)) fail('o valor vinculado excede o saldo disponível do envio.');
      used.set(a.movement.id,sum);
      return { movement_id: a.movement.id, amount_cents: amount };
    });
    const allocated = allocations.reduce((sum,a) => sum+BigInt(a.amount_cents),0n);
    if (allocated > BigInt(cents!)) fail('o valor vinculado excede o gasto.');
    if (allocated < BigInt(cents!) && line.payeeType === 'driver' && !draft.trip?.driver_id) fail('selecione o favorecido do complemento.');
    const delivery = line.delivery?.delivery;
    if (line.category === 'unloading' && (draft.context !== 'trip' || !delivery || delivery.issue || !delivery.supplier_id
      || delivery.trip_id !== draft.trip?.id || !line.receiptPath)) fail('selecione uma entrega válida e anexe o comprovante da descarga.');
    return { id: line.id, category: line.category, description: line.description.trim(), amount_cents: cents!, occurred_on: line.date,
      supplier_name: line.supplier?.label || line.supplierName.trim(), ...(line.supplier ? {supplier_id: line.supplier.id} : {}),
      ...(line.center ? {cost_center_id: line.center.id} : {}), ...(line.document ? {document_number: line.document} : {}),
      ...(line.receiptPath ? {receipt_path: line.receiptPath} : {no_receipt_reason: line.noReceiptReason.trim()}),
      ...(line.dueDate ? {due_date: line.dueDate} : {}), payee_type: line.payeeType, allocations,
      ...(line.category === 'unloading' ? {stop_id: line.delivery!.id, delivery_revision: delivery!.revision} : {}) };
  });
  return { version: 1 as const, tenant_id: tenant, request_id: request, context: draft.context,
    ...(draft.context === 'trip' ? {trip_id: draft.trip!.id} : {}), description: draft.description.trim(), reason: draft.reason.trim(), items };
}
export type ExpenseBatchCommand = ReturnType<typeof buildExpenseBatch>;
export const expenseBatchResultSchema = z.object({ version: z.literal(1), tenant_id: uuid, request_id: uuid, batch_id: uuid,
  confirmed: z.literal(true), rows: z.array(z.object({expense_id: uuid, payable_id: uuid.nullable(), unloading_id: uuid.nullable()})) });
