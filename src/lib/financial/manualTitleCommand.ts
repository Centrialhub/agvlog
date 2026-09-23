import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
export type ManualTitleKind = "payable" | "receivable";
const commandSchema = z
  .object({
    version: z.literal(1),
    tenant_id: z.string().uuid(),
    request_id: z.string().uuid(),
    kind: z.enum(["payable", "receivable"]),
    id: z.string().uuid().nullable(),
    expected_updated_at: z.string().nullable(),
    fields: z.record(z.unknown()),
    duplicate_reason: z.string().max(2000),
  })
  .strict();
export type ManualTitleCommand = z.infer<typeof commandSchema>;
export const manualTitleKey = (
  tenant: string,
  actor: string,
  kind: ManualTitleKind,
) => `agvlog:manual-title:v1:${tenant}:${actor}:${kind}`;
export const manualTitleChanged = () =>
  window.dispatchEvent(new Event("finance-operations-updated"));
export function readManualTitle(
  tenant: string,
  actor: string,
  kind: ManualTitleKind,
) {
  const raw = localStorage.getItem(manualTitleKey(tenant, actor, kind));
  if (!raw) return null;
  const value = commandSchema.parse(JSON.parse(raw));
  if (value.tenant_id !== tenant || value.kind !== kind)
    throw new Error("Pedido salvo fora da empresa.");
  return value;
}
function errorLabel(message: string) {
  if (message.includes("possible_duplicate"))
    return "Já existe um título semelhante. Confira documento, contraparte, vencimento e valor. Para criar outro legítimo, informe a justificativa de duplicidade.";
  if (message.includes("manual_title_changed"))
    return "Este título foi alterado por outra pessoa. Seu formulário foi preservado. Feche e reabra o título para conferir a versão atual antes de salvar.";
  if (message.includes("access_denied"))
    return "Seu perfil não permite salvar este título nesta empresa.";
  if (message.includes("origin_required"))
    return "Este título deve ser corrigido na origem operacional.";
  return message;
}
export async function saveManualTitle(
  tenant: string,
  actor: string,
  kind: ManualTitleKind,
  fields?: Record<string, unknown>,
  id: string | null = null,
  expected: string | null = null,
  duplicateReason = "",
) {
  if (!navigator.locks)
    throw new Error(
      "Este navegador não permite proteger pedidos entre abas. Atualize o navegador.",
    );
  const key = manualTitleKey(tenant, actor, kind);
  return navigator.locks.request(key, async () => {
    const pending = readManualTitle(tenant, actor, kind);
    if (
      pending &&
      fields &&
      (JSON.stringify(pending.fields) !== JSON.stringify(fields) ||
        pending.id !== id)
    )
      throw new Error(
        "Há um salvamento sem confirmação. Retome o pedido original antes de salvar outros dados.",
      );
    if (!pending && !fields)
      throw new Error(
        "O pedido já foi confirmado em outra aba. Atualize a lista.",
      );
    const command =
      pending ??
      commandSchema.parse({
        version: 1,
        tenant_id: tenant,
        request_id: crypto.randomUUID(),
        kind,
        id,
        expected_updated_at: expected,
        fields,
        duplicate_reason: duplicateReason,
      });
    localStorage.setItem(key, JSON.stringify(command));
    manualTitleChanged();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{
      data: unknown;
      error: { code?: string; message: string } | null;
    }>;
    const { data, error } = await rpc("save_finance_manual_title", {
      _payload: command,
    });
    if (error) {
      if (["22023", "23514", "55000", "40001"].includes(error.code || "")) {
        localStorage.removeItem(key);
        manualTitleChanged();
      }
      throw new Error(errorLabel(error.message));
    }
    const result = z
      .object({
        version: z.literal(1),
        tenant_id: z.string().uuid(),
        request_id: z.string().uuid(),
        confirmed: z.literal(true),
        kind: z.enum(["payable", "receivable"]),
        record: z
          .object({ id: z.string().uuid(), tenant_id: z.string().uuid() })
          .passthrough(),
      })
      .parse(data);
    if (
      result.tenant_id !== tenant ||
      result.request_id !== command.request_id ||
      result.kind !== kind ||
      result.record.tenant_id !== tenant ||
      (command.id && result.record.id !== command.id)
    )
      throw new Error(
        "Resposta fora do pedido original. Retome o mesmo salvamento.",
      );
    localStorage.removeItem(key);
    manualTitleChanged();
    return result.record;
  });
}
