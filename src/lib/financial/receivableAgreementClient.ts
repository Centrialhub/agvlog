import { supabase } from "@/integrations/supabase/client";
import {
  receivableAgreementCommandSchema,
  receivableAgreementHistorySchema,
  receivableAgreementPositionSchema,
  receivableAgreementPreviewSchema,
  receivableAgreementProposalSchema,
  receivableAgreementResultSchema,
  type ReceivableAgreementCommand,
  type ReceivableAgreementProposal,
} from "./receivableAgreementContract";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
const rpc: Rpc = (name, args) =>
  (supabase.rpc.bind(supabase) as unknown as Rpc)(name, args);
const match = <
  T extends { tenant_id: string; actor_id: string; receivable_id: string },
>(
  value: T,
  tenant: string,
  actor: string,
  receivable: string,
): T => {
  if (
    value.tenant_id !== tenant ||
    value.actor_id !== actor ||
    value.receivable_id !== receivable
  )
    throw Error(
      "Resposta de renegociação fora do título e da sessão solicitados.",
    );
  return value;
};
export async function readReceivableAgreementPosition(
  tenant: string,
  actor: string,
  receivable: string,
) {
  const { data, error } = await rpc(
    "get_finance_receivable_installment_position",
    { _tenant_id: tenant, _receivable_id: receivable },
  );
  if (error) throw error;
  return match(
    receivableAgreementPositionSchema.parse(data),
    tenant,
    actor,
    receivable,
  );
}
export async function previewReceivableAgreement(
  tenant: string,
  actor: string,
  receivable: string,
  proposal: ReceivableAgreementProposal,
) {
  const parsed = receivableAgreementProposalSchema.parse(proposal),
    { data, error } = await rpc("get_finance_receivable_agreement_context", {
      _tenant_id: tenant,
      _receivable_id: receivable,
      _proposal: parsed,
    });
  if (error) throw error;
  return match(
    receivableAgreementPreviewSchema.parse(data),
    tenant,
    actor,
    receivable,
  );
}
export async function readReceivableAgreementHistory(
  tenant: string,
  actor: string,
  receivable: string,
  offset = 0,
  limit = 30,
  expectedRevision?: string,
) {
  const { data, error } = await rpc(
    "get_finance_receivable_agreement_history",
    {
      _tenant_id: tenant,
      _receivable_id: receivable,
      _offset: offset,
      _limit: limit,
      _expected_revision: expectedRevision ?? null,
    },
  );
  if (error) throw error;
  return match(
    receivableAgreementHistorySchema.parse(data),
    tenant,
    actor,
    receivable,
  );
}
export async function readClosingReceivableAgreement(tenant:string,actor:string,report:string){
 const {data,error}=await rpc("get_finance_closing_receivable_agreement",{_tenant_id:tenant,_report_id:report});if(error)throw error;
 const base=data as {tenant_id?:unknown;actor_id?:unknown;report_id?:unknown;receivable_id?:unknown;agreement?:unknown};
 if(base.tenant_id!==tenant||base.actor_id!==actor||base.report_id!==report||base.receivable_id!==null&&typeof base.receivable_id!=="string")throw Error("Agenda fora do fechamento solicitado.");
 return {receivable_id:base.receivable_id as string|null,agreement:base.agreement===null?null:receivableAgreementPositionSchema.parse(base.agreement)};
}
export async function sendReceivableAgreement(
  command: ReceivableAgreementCommand,
) {
  const payload = receivableAgreementCommandSchema.parse(command),
    { data, error } = await rpc("record_finance_receivable_agreement", {
      _payload: payload,
    });
  if (error) throw error;
  return receivableAgreementResultSchema.parse(data);
}
export function receivableAgreementError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
  const code = message.match(/finance_(?:agreement|receivable)_[a-z_]+/)?.[0];
  const labels: Record<string, string> = {
    finance_agreement_changed:
      "A posição financeira mudou. Gere uma nova prévia.",
    finance_agreement_unavailable:
      "A renegociação não está disponível para esta posição.",
    finance_agreement_busy:
      "Outro pedido está alterando este título. Tente novamente.",
    finance_agreement_requires_reallocation:
      "Há saldo restaurado sem parcela. Revise o acordo antes de outra baixa.",
    finance_agreement_source_blocked:
      "A origem do título bloqueia novas operações.",
  };
  return (
    (code && labels[code]) ||
    message ||
    "Não foi possível processar a renegociação. O pedido preservado pode ser recuperado."
  );
}
