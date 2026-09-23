import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { FiscalWorkRow } from "@/lib/financial/fiscalQueueContract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const schema = z.object({
  version: z.literal(1),
  tenant_id: z.string().uuid(),
  request_id: z.string().uuid(),
  observation_id: z.string().uuid(),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(5).max(2000),
});
export function FiscalReviewAssignment({
  tenant,
  actor,
  row,
}: {
  tenant: string;
  actor: string;
  row: FiscalWorkRow;
}) {
  const key = `agvlog:fiscal-review:v1:${tenant}:${actor}:${row.observation_id}`,
    cache = useQueryClient();
  const [due, setDue] = useState(row.assignment?.due_on || ""),
    [note, setNote] = useState(row.assignment?.note || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { pending: null };
      const pending = schema.parse(JSON.parse(raw));
      if (
        pending.tenant_id !== tenant ||
        pending.observation_id !== row.observation_id
      )
        throw new Error();
      return { pending };
    } catch {
      return { pending: null, blocked: true };
    }
  });
  const [pending, setPending] = useState(recovery.pending);
  async function save() {
    if (busy || recovery.blocked) return;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw new Error(
          "Atualize o navegador para proteger o pedido entre abas.",
        );
      await navigator.locks.request(key, async () => {
        const original = localStorage.getItem(key);
        const command = original
          ? schema.parse(JSON.parse(original))
          : schema.parse({
              version: 1,
              tenant_id: tenant,
              request_id: crypto.randomUUID(),
              observation_id: row.observation_id,
              revision: row.assignment_revision,
              due_on: due,
              note,
            });
        if (
          command.tenant_id !== tenant ||
          command.observation_id !== row.observation_id
        )
          throw new Error("Pedido fora do documento.");
        localStorage.setItem(key, JSON.stringify(command));
        setPending(command);
        const rpc = supabase.rpc.bind(supabase) as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => PromiseLike<{
          data: unknown;
          error: { code?: string; message: string } | null;
        }>;
        const { data, error: failure } = await rpc(
          "assign_finance_fiscal_review",
          { _payload: command },
        );
        if (failure) {
          if (["22023", "40001"].includes(failure.code || "")) {
            localStorage.removeItem(key);
            setPending(null);
          }
          throw new Error(
            failure.code === "40001"
              ? "A pendência mudou. Atualize a fila e confira novamente."
              : failure.message,
          );
        }
        const ack = z
          .object({
            confirmed: z.literal(true),
            tenant_id: z.literal(tenant),
            request_id: z.literal(command.request_id),
            observation_id: z.literal(row.observation_id),
          })
          .parse(data);
        if (ack.confirmed) {
          localStorage.removeItem(key);
          setPending(null);
          await cache.invalidateQueries({
            queryKey: ["finance-fiscal-queue", tenant],
          });
        }
      });
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "Informe prazo e encaminhamento com pelo menos cinco caracteres."
          : e instanceof Error
            ? e.message
            : "Resposta não confirmada.",
      );
    } finally {
      setBusy(false);
    }
  }
  const source =
    row.document_type === "cte"
      ? `/cte-monitor?${new URLSearchParams({ ...(row.cte_document_id ? { cteId: row.cte_document_id } : {}), ...(row.fiscal_document_id ? { fiscalDocumentId: row.fiscal_document_id } : {}), ...(row.document_number ? { docNumber: row.document_number } : {}) })}`
      : `/nfse?${new URLSearchParams({ ...(row.nfse_document_id ? { nfseId: row.nfse_document_id } : {}), ...(row.document_number ? { docNumber: row.document_number } : {}) })}`;
  return (
    <section className="mt-3 space-y-2">
      <Link className="underline" to={source}>
        Abrir documento de origem
      </Link>
      {row.assignment ? (
        <p>
          Responsável: {row.assignment.actor_name} · prazo:{" "}
          {row.assignment.due_on} · {row.assignment.note}
        </p>
      ) : (
        <p>Sem responsável definido.</p>
      )}
      {(pending || (row.is_current && row.status === "review")) && (
        <>
          <label>
            Prazo da revisão
            <Input
              type="date"
              value={pending?.due_on || due}
              disabled={busy || !!pending || recovery.blocked}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label>
            Próximo passo
            <Input
              value={pending?.note || note}
              disabled={busy || !!pending || recovery.blocked}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </label>
          <Button
            disabled={busy || recovery.blocked}
            onClick={() => void save()}
          >
            {pending
              ? "Retomar atribuição original"
              : "Assumir revisão e salvar prazo"}
          </Button>
        </>
      )}
      {recovery.blocked && (
        <p role="alert">Não foi possível recuperar a atribuição salva.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
