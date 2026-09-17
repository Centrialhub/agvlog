import { ReceivableAdjustmentAmounts } from "./ReceivableAdjustmentAmounts";
import type { ReceivableAdjustmentComposition } from "@/lib/financial/receivableAdjustmentContract";
const amounts = (v: ReceivableAdjustmentComposition) => ({
  nominal: v.amount_cents,
  cash: v.cash_received_cents,
  credit: v.credit_applied_cents,
  discount: v.discount_cents,
  loss: v.loss_cents,
  settled: v.settled_cents,
  open: v.open_cents,
});
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatFinanceCents } from "@/lib/financial/ledgerContract";
import type { ReceivableAdjustmentPreview } from "@/lib/financial/receivableAdjustmentContract";
import {
  receivableAdjustmentError,
  sendReceivableAdjustment,
} from "@/lib/financial/receivableAdjustmentClient";
import {
  createReceivableAdjustmentOutbox,
  receivableAdjustmentKey,
  lockReceivableAdjustment,
  pendingReceivableAdjustment,
  type PendingReceivableAdjustment,
} from "@/lib/financial/receivableAdjustmentOutbox";
import {
  ReceivableInstallmentAllocationFields,
  type ReceivableAgreementDistribution,
} from "./ReceivableInstallmentAllocationFields";
export function ReceivableAdjustmentConfirmation({
  tenant,
  actor,
  preview,
  refresh,
}: {
  tenant: string;
  actor: string;
  preview: ReceivableAdjustmentPreview | undefined;
  refresh: () => Promise<unknown>;
}) {
  const live = useRef({ tenant, actor, active: true });
  live.current = { tenant, actor, active: true };
  const [pending, setPending] = useState<PendingReceivableAdjustment | null>(
      null,
    ),
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
      setPending(pendingReceivableAdjustment(localStorage, tenant, actor));
      setCorrupt(false);
    } catch {
      setCorrupt(true);
    }
  };
  const discardCorrupt=()=>{setError("");try{localStorage.removeItem(receivableAdjustmentKey(tenant,actor));setPending(null);setCorrupt(false);}catch{setError("Não foi possível descartar o pedido incompatível neste navegador.");}};
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const [outbox] = useState(() =>
    createReceivableAdjustmentOutbox({
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
      lock: lockReceivableAdjustment,
      send: sendReceivableAdjustment,
    }),
  );
  useEffect(() => {
    live.current.active = true;
    syncRef.current();
    const listener = (e: StorageEvent) => {
      if (e.key === null || e.key === receivableAdjustmentKey(tenant, actor))
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
            receivable_id: preview!.receivable_id,
            action: preview!.action,
            kind: preview!.kind,
            adjustment_id: preview!.adjustment_id,
            effective_on: preview!.effective_on,
            expected: preview!.effects,
            amount_cents: preview!.amount_cents,
            expected_revision: preview!.revision,
            reason,
            ...distribution,
          });
      setConfirmed(
        `${result.action === "apply" ? "Baixa sem caixa registrada" : "Reversão de baixa registrada"} no título ${result.receivable_id}: ${formatFinanceCents(result.amount_cents)}. Pedido ${result.request_id}. Nenhum novo dinheiro foi movimentado.`,
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
      setError(receivableAdjustmentError(failure));
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
      aria-label="Confirmação da baixa sem caixa"
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
          <ReceivableAdjustmentAmounts
            current={amounts(pending.expected.before)}
            proposed={amounts(pending.expected.after)}
          />
          <p>
            Pedido preservado {pending.payload.request_id} · título{" "}
            {pending.payload.receivable_id} ·{" "}
            {pending.payload.kind === "discount" ? "desconto" : "perda"} ·{" "}
            {pending.payload.effective_on}
          </p>
          <p>
            {pending.payload.action === "apply" ? "Baixar" : "Reverter"}{" "}
            {formatFinanceCents(pending.payload.amount_cents)}. Motivo:{" "}
            {pending.payload.reason}
          </p>
          {preview &&
            (preview.receivable_id !== pending.payload.receivable_id ||
              preview.adjustment_id !== pending.payload.adjustment_id) && (
              <p>
                Este pedido pertence a outra seleção; recuperar repete somente o
                pedido original.
              </p>
            )}
          <Button disabled={busy} onClick={() => void execute(true)}>
            Recuperar pedido de baixa
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
            Conferi o título, a categoria e os valores antes e depois. Esta
            baixa ou reversão não movimenta dinheiro nem altera o nominal.
          </label>
          <Button
            disabled={
              busy || checked !== preview.revision || reason.trim().length < 5
            }
            onClick={() => void execute(false)}
          >
            Confirmar ajuste do recebível
          </Button>
        </>
      ) : (
        <p>Confirmação indisponível. Consulte uma prévia atual.</p>
      )}
    </section>
  );
}
