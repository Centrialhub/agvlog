import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseMoneyCents } from "@/lib/financial/receivableCommands";
const limit = z.number().int().nonnegative().nullable();
const policySchema = z.object({
  version: z.literal(1),
  tenant_id: z.string().uuid(),
  revision: z.string(),
  can_configure: z.boolean(),
  policy: z.object({
    enabled: z.boolean(),
    operator_limit_cents: limit,
    admin_limit_cents: limit,
    prevent_self_approval: z.boolean(),
  }),
});
const commandSchema = z.object({
  version: z.literal(1),
  tenant_id: z.string().uuid(),
  request_id: z.string().uuid(),
  revision: z.string(),
  enabled: z.boolean(),
  operator_limit_cents: z.string().nullable(),
  admin_limit_cents: z.string().nullable(),
  prevent_self_approval: z.boolean(),
  reason: z.string().min(10).max(2000),
});
const parseLimit = (value: string) =>
  !value.trim()
    ? null
    : /^0(?:[,.]0{1,2})?$/.test(value.trim())
      ? "0"
      : String(parseMoneyCents(value));
const rpc = ((name: unknown, args: unknown) => (supabase.rpc.bind(supabase) as unknown as (name: unknown, args: unknown) => unknown)(name, args)) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;
export function ApprovalPolicySettings({
  tenant,
  actor,
}: {
  tenant: string;
  actor: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded border p-3"
    >
      <summary>Alçadas de aprovação</summary>
      {open && (
        <ApprovalPolicyForm
          key={`${tenant}:${actor}`}
          tenant={tenant}
          actor={actor}
        />
      )}
    </details>
  );
}
function ApprovalPolicyForm({
  tenant,
  actor,
}: {
  tenant: string;
  actor: string;
}) {
  const cache = useQueryClient(),
    key = `agvlog:approval-policy:v1:${tenant}:${actor}`;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{
    enabled: boolean;
    operator: string;
    admin: string;
    self: boolean;
    reason: string;
  } | null>(null);
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      const pending = raw ? commandSchema.parse(JSON.parse(raw)) : null;
      if (pending && pending.tenant_id !== tenant) throw Error();
      return { pending, blocked: false };
    } catch {
      return { pending: null, blocked: true };
    }
  });
  const [pending, setPending] = useState(recovery.pending);
  const query = useQuery({
    queryKey: ["finance-approval-policy", tenant, actor],
    retry: false,
    queryFn: async () => {
      const { data, error } = await rpc("get_finance_approval_policy", {
        _tenant_id: tenant,
      });
      if (error) throw error;
      const v = policySchema.parse(data);
      if (v.tenant_id !== tenant) throw Error("Resposta fora da empresa.");
      return v;
    },
  });
  const data = query.isFetching || query.error ? undefined : query.data;
  const value = draft ?? {
    enabled: data?.policy.enabled ?? false,
    operator:
      data?.policy.operator_limit_cents == null
        ? ""
        : String(data.policy.operator_limit_cents / 100).replace(".", ","),
    admin:
      data?.policy.admin_limit_cents == null
        ? ""
        : String(data.policy.admin_limit_cents / 100).replace(".", ","),
    self: data?.policy.prevent_self_approval ?? false,
    reason: "",
  };
  async function save() {
    if (busy || recovery.blocked || !data?.can_configure) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!navigator.locks)
        throw Error(
          "Atualize o navegador para proteger a configuração entre abas.",
        );
      await navigator.locks.request(key, async () => {
        const raw = localStorage.getItem(key);
        const command = raw
          ? commandSchema.parse(JSON.parse(raw))
          : commandSchema.parse({
              version: 1,
              tenant_id: tenant,
              request_id: crypto.randomUUID(),
              revision: data.revision,
              enabled: value.enabled,
              operator_limit_cents: parseLimit(value.operator),
              admin_limit_cents: parseLimit(value.admin),
              prevent_self_approval: value.self,
              reason: value.reason.trim(),
            });
        if (command.tenant_id !== tenant)
          throw Error("Configuração fora da empresa.");
        localStorage.setItem(key, JSON.stringify(command));
        setPending(command);
        window.dispatchEvent(new Event("finance-operations-updated"));
        const response = await rpc("save_finance_approval_policy", {
          _payload: command,
        });
        if (response.error) {
          if (["22023", "40001"].includes(response.error.code || "")) {
            localStorage.removeItem(key);
            setPending(null);
          }
          throw Error(
            response.error.code === "40001"
              ? "A regra mudou. Atualize e confira os limites antes de salvar."
              : response.error.message,
          );
        }
        z.object({
          confirmed: z.literal(true),
          tenant_id: z.literal(tenant),
          request_id: z.literal(command.request_id),
        }).parse(response.data);
        localStorage.removeItem(key);
        setPending(null);
        setDraft(null);
        setNotice("Regra de aprovação salva.");
        await cache.invalidateQueries({
          queryKey: ["finance-approval-policy", tenant],
        });
        await cache.invalidateQueries({
          queryKey: ["finance-payable-approval", tenant],
        });
      });
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "Confira os valores e informe um motivo com pelo menos dez caracteres."
          : e instanceof Error
            ? e.message
            : "Resposta não confirmada.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-3 space-y-3">
      <p>
        A regra atual permanece enquanto as alçadas estiverem desativadas.
        Limite vazio significa sem teto; zero bloqueia aprovações do perfil.
        Proprietários não têm teto de valor. Os limites não concedem novas
        permissões.
      </p>
      {query.error && (
        <p role="alert">
          Não foi possível consultar a regra.{" "}
          <Button onClick={() => void query.refetch()}>Atualizar regra</Button>
        </p>
      )}
      {recovery.blocked && (
        <p role="alert">
          A configuração salva não pôde ser recuperada. Confira o histórico
          antes de iniciar outro pedido.
        </p>
      )}
      {pending && (
        <p role="status">
          Há uma configuração sem resposta confirmada. Retome o pedido original.
        </p>
      )}
      {data && !data.can_configure && (
        <p>Somente administradores podem configurar alçadas.</p>
      )}
      {data?.can_configure && (
        <>
          <fieldset
            disabled={busy || !!pending || recovery.blocked}
            className="space-y-3"
          >
            <label className="block">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) =>
                  setDraft({ ...value, enabled: e.target.checked })
                }
              />{" "}
              Ativar alçadas
            </label>
            <label className="block">
              Limite por aprovação de operador (R$)
              <Input
                value={value.operator}
                onChange={(e) =>
                  setDraft({ ...value, operator: e.target.value })
                }
              />
            </label>
            <label className="block">
              Limite por aprovação de administrador (R$)
              <Input
                value={value.admin}
                onChange={(e) => setDraft({ ...value, admin: e.target.value })}
              />
            </label>
            <label className="block">
              <input
                type="checkbox"
                checked={value.self}
                onChange={(e) => setDraft({ ...value, self: e.target.checked })}
              />{" "}
              Exigir aprovador diferente do criador ou último editor
            </label>
            <label className="block">
              Motivo da mudança
              <Input
                value={value.reason}
                maxLength={2000}
                onChange={(e) => setDraft({ ...value, reason: e.target.value })}
              />
            </label>
          </fieldset>
          <Button
            disabled={
              busy ||
              recovery.blocked ||
              (!pending && value.reason.trim().length < 10)
            }
            onClick={() => void save()}
          >
            {pending
              ? "Retomar configuração original"
              : "Salvar regra de aprovação"}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
