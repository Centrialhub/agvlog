import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatFinanceCents } from "@/lib/financial/ledgerContract";
import type { CustomerCreditPreview } from "@/lib/financial/customerCreditContract";
import {
  customerCreditError,
  sendCustomerCredit,
} from "@/lib/financial/customerCreditClient";
import {
  createCustomerCreditOutbox,
  customerCreditKey,
  lockCustomerCredit,
  pendingCustomerCredit,
  type PendingCustomerCredit,
} from "@/lib/financial/customerCreditOutbox";
import {
  ReceivableInstallmentAllocationFields,
  type ReceivableAgreementDistribution,
} from "./ReceivableInstallmentAllocationFields";
export function CustomerCreditConfirmation({
  tenant,
  actor,
  preview,
  refresh,
}: {
  tenant: string;
  actor: string;
  preview: CustomerCreditPreview | undefined;
  refresh: () => Promise<unknown>;
}) {
  const live = useRef({ tenant, actor, active: true });
  live.current = { tenant, actor, active: true };
  const [pending, setPending] = useState<PendingCustomerCredit | null>(null),
    [corrupt, setCorrupt] = useState(false),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState<string | null>(null),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState("");
  const [distribution, setDistribution] =
      useState<ReceivableAgreementDistribution | null>(null),
    changeDistribution = useCallback(
      (value: ReceivableAgreementDistribution | null) => {
        setDistribution(value);
        setChecked(null);
      },
      [],
    );
  const sync = () => {
    try {
      setPending(pendingCustomerCredit(localStorage, tenant, actor));
      setCorrupt(false);
    } catch {
      setCorrupt(true);
    }
  };
  const discardCorrupt=()=>{setError("");try{localStorage.removeItem(customerCreditKey(tenant,actor));setPending(null);setCorrupt(false);}catch{setError("Não foi possível descartar o pedido incompatível neste navegador.");}};
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const [outbox] = useState(() =>
    createCustomerCreditOutbox({
      storage: localStorage,
      uuid: () => crypto.randomUUID(),
      changed: () => {
        if (live.current.active) syncRef.current();
      },
      assertContext: (t, a) => {
        if (
          !live.current.active ||
          t !== live.current.tenant ||
          a !== live.current.actor
        )
          throw Error("Recupere o pedido na sessão original.");
      },
      lock: lockCustomerCredit,
      send: sendCustomerCredit,
    }),
  );
  useEffect(() => {
    live.current.active = true;
    syncRef.current();
    const listener = (e: StorageEvent) => {
      if (e.key === null || e.key === customerCreditKey(tenant, actor))
        syncRef.current();
    };
    window.addEventListener("storage", listener);
    return () => {
      live.current.active = false;
      window.removeEventListener("storage", listener);
    };
  }, [tenant, actor]);
  const fresh =
    preview?.can_execute &&
    preview.eligible &&
    preview.tenant_id === tenant &&
    preview.actor_id === actor &&
    distribution !== null;
  async function execute(recover: boolean) {
    if (
      busy ||
      corrupt ||
      confirmed ||
      (!recover &&
        (!fresh || checked !== preview?.revision || reason.trim().length < 5))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = recover
        ? await outbox.recover(tenant, actor)
        : await outbox.submit(tenant, actor, {
            credit_id: preview!.credit_id,
            receivable_id: preview!.receivable_id,
            application_id: preview!.application_id,
            action: preview!.action,
            amount_cents: preview!.amount_cents,
            expected_revision: preview!.revision,
            reason,
            ...distribution,
          });
      setConfirmed(
        `${result.action === "apply" ? "Aplicação" : "Liberação"} registrada: ${formatFinanceCents(result.amount_cents)}. Título ${result.receivable_id}. Pedido ${result.request_id}. Nenhum dinheiro foi movimentado.`,
      );
      setChecked(null);
      try {
        await refresh();
      } catch {
        setError(
          "A operação foi registrada, mas a consulta não foi atualizada. Atualize antes de continuar.",
        );
      }
    } catch (failure) {
      setChecked(null);
      setError(customerCreditError(failure));
      try {
        await refresh();
      } catch {
        /* Preserve the original rejection and durable request. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-2 rounded border p-3"
      aria-label="Confirmação do crédito"
    >
      {preview ? (
        <ReceivableInstallmentAllocationFields
          key={[preview.receivable_id, preview.action, preview.amount_cents].join(":")}
          tenant={tenant}
          actor={actor}
          receivable={preview.receivable_id}
          amountCents={preview.amount_cents}
          enabled={preview.action === "apply"}
          onChange={changeDistribution}
        />
      ) : null}
      {error && <p role="alert">{error}</p>}
      {confirmed ? (
        <p role="status">{confirmed}</p>
      ) : corrupt ? (
        <div role="alert">
          <p>O pedido salvo está inconsistente e não pode ser recuperado. Nova operação bloqueada até o descarte.</p>
          <Button disabled={busy} onClick={discardCorrupt}>Descartar pedido incompatível</Button>
        </div>
      ) : pending ? (
        <>
          <p>
            Pedido preservado {pending.payload.request_id} · crédito{" "}
            {pending.payload.credit_id} · título {pending.payload.receivable_id}
          </p>
          <p>
            {pending.payload.action === "apply" ? "Aplicar" : "Liberar"}{" "}
            {formatFinanceCents(pending.payload.amount_cents)}. Motivo:{" "}
            {pending.payload.reason}
          </p>
          {preview &&
            (preview.credit_id !== pending.payload.credit_id ||
              preview.receivable_id !== pending.payload.receivable_id) && (
              <p>
                Este pedido pertence a outra seleção; recuperar repete somente o
                pedido original.
              </p>
            )}
          <Button disabled={busy} onClick={() => void execute(true)}>
            Recuperar pedido de crédito
          </Button>
        </>
      ) : fresh ? (
        <>
          <label className="block">
            Motivo
            <textarea
              value={reason}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setChecked(null);
              }}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={checked === preview.revision}
              disabled={busy}
              onChange={(e) =>
                setChecked(e.target.checked ? preview.revision : null)
              }
            />{" "}
            Conferi título, pagador e valor.{" "}
            {preview.action === "apply"
              ? "A aplicação liquida parte do título usando crédito existente."
              : "A liberação devolve disponibilidade ao crédito e reabre o valor do título; não devolve dinheiro."}
          </label>
          <Button
            disabled={
              busy || checked !== preview.revision || reason.trim().length < 5
            }
            onClick={() => void execute(false)}
          >
            Confirmar {preview.action === "apply" ? "aplicação" : "liberação"}
          </Button>
        </>
      ) : (
        <p>Confirmação indisponível. Consulte uma prévia atual.</p>
      )}
    </section>
  );
}
