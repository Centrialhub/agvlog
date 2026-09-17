import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatFinanceCents } from "@/lib/financial/ledgerContract";
import { parseMoneyCents } from "@/lib/financial/receivableCommands";
import { previewReceivableAgreement, readReceivableAgreementHistory, readReceivableAgreementPosition, receivableAgreementError, sendReceivableAgreement } from "@/lib/financial/receivableAgreementClient";
import { receivableAgreementStorageKey, type ReceivableAgreementInstallment, type ReceivableAgreementPreview, type ReceivableAgreementProposal } from "@/lib/financial/receivableAgreementContract";
import { createReceivableAgreementOutbox, discardPendingReceivableAgreement, lockReceivableAgreement, pendingReceivableAgreement, type PendingReceivableAgreement } from "@/lib/financial/receivableAgreementOutbox";

type Draft = { id: string; amount: string; due: string };
const newRow = (): Draft => ({ id: crypto.randomUUID(), amount: "", due: "" });
export function ReceivableAgreementDialog({
  tenant,
  actor,
  receivable,
  onClose,
}: {
  tenant: string;
  actor: string;
  receivable: string;
  onClose: () => void;
}) {
  const cache = useQueryClient(),
    live = useRef({ tenant, actor, active: true }),
    [rows, setRows] = useState<Draft[]>([newRow()]),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<{
      data: ReceivableAgreementPreview;
      proposal: ReceivableAgreementProposal;
    } | null>(null),
    [pending, setPending] = useState<PendingReceivableAgreement | null>(null),
    [recoveryError, setRecoveryError] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [notice, setNotice] = useState("");
  const [historyOffset,setHistoryOffset]=useState(0);
  live.current = { tenant, actor, active: true };
  const sync = useCallback(() => {
    const current = live.current;
    try {
      setPending(
        pendingReceivableAgreement(localStorage, current.tenant, current.actor),
      );
      setRecoveryError("");
    } catch (cause) {
      const message = receivableAgreementError(cause);
      setPending(null);
      setRecoveryError(message);
    }
  }, []);
  const [outbox] = useState(() =>
    createReceivableAgreementOutbox({
      storage: localStorage,
      uuid: () => crypto.randomUUID(),
      changed: sync,
      lock: lockReceivableAgreement,
      send: sendReceivableAgreement,
      isDefinitive: (error) => {
        const code =
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "";
        return (
          /^(22|23)/.test(code) ||
          ["40001", "42501", "55000", "55P03"].includes(code)
        );
      },
      assertContext: (t, a) => {
        if (
          !live.current.active ||
          live.current.tenant !== t ||
          live.current.actor !== a
        )
          throw Error("Recupere a renegociação na sessão original.");
      },
    }),
  );
  useEffect(() => {
    sync();
    const key = receivableAgreementStorageKey(tenant, actor),
      listener = (event: StorageEvent) => {
        if (event.key === key) sync();
      };
    window.addEventListener("storage", listener);
    return () => {
      live.current.active = false;
      window.removeEventListener("storage", listener);
    };
  }, [tenant, actor, sync]);
  const positionQuery = useQuery({
      queryKey: ["receivable-agreement-position", tenant, actor, receivable],
      queryFn: () => readReceivableAgreementPosition(tenant, actor, receivable),
      retry: false,
    }),
    position = positionQuery.data;
  const historyQuery = useQuery({
    queryKey: [
      "receivable-agreement-history",
      tenant,
      actor,
      receivable,
      position?.revision,
      historyOffset,
    ],
    queryFn: () =>
      readReceivableAgreementHistory(
        tenant,
        actor,
        receivable,
        historyOffset,
        30,
        position!.revision,
      ),
    enabled: !!position,
    retry: false,
  });
  const action: ReceivableAgreementProposal["action"] =
    position?.status === "active" ? "revise" : "create";
  const installments = useMemo(() => {
    try {
      if (rows.length < 1 || rows.length > 100) return null;
      return rows.map((row) => ({
        id: row.id,
        amount_cents: String(parseMoneyCents(row.amount)),
        due_on: row.due,
      })) as ReceivableAgreementInstallment[];
    } catch {
      return null;
    }
  }, [rows]);
  const changed = () => {
    setPreview(null);
    setNotice("");
  };
  const check = async (
    proposalAction: ReceivableAgreementProposal["action"] = action,
  ) => {
    setError("");
    setNotice("");
    try {
      const proposal = {
        action: proposalAction,
        installments: proposalAction === "revoke" ? [] : installments,
      };
      if (!proposal.installments)
        throw Error("Informe valores válidos para todas as parcelas.");
      const parsed = proposal as ReceivableAgreementProposal,
        value = await previewReceivableAgreement(
          tenant,
          actor,
          receivable,
          parsed,
        );
      setPreview({ data: value, proposal: parsed });
    } catch (cause) {
      setError(receivableAgreementError(cause));
    }
  };
  const confirmAgreement = async () => {
    if (!preview || working) return;
    setWorking(true);
    setError("");
    try {
      const result = await outbox.submit(tenant, actor, {
        receivable_id: receivable,
        action: preview.proposal.action,
        expected_revision: preview.data.revision,
        reason,
        installments: preview.proposal.installments,
      });
      setPreview(null);
      setRows([newRow()]);
      setHistoryOffset(0);
      setNotice(
        `Renegociação ${result.action === "revoke" ? "revogada" : "confirmada"} sem alterar o valor nominal ou criar outro título.`,
      );
      await Promise.all([
        cache.invalidateQueries({
          queryKey: [
            "receivable-agreement-position",
            tenant,
            actor,
            receivable,
          ],
        }),
        cache.invalidateQueries({
          queryKey: ["receivable-agreement-history", tenant, actor, receivable],
        }),
        cache.invalidateQueries({queryKey:["finance-cash-forecast-preview",tenant]}),
        cache.invalidateQueries({queryKey:["finance-cash-forecast-agenda",tenant]}),
        cache.invalidateQueries({queryKey:["finance-cash-forecast-sources",tenant]}),
      ]);
    } catch (cause) {
      setError(receivableAgreementError(cause));
    } finally {
      setWorking(false);
    }
  };
  const recover = async () => {
    setWorking(true);
    setError("");
    try {
      await outbox.recover(tenant, actor);
      setNotice("Pedido preservado recuperado com a mesma identidade.");
      await cache.invalidateQueries({
        queryKey: ["receivable-agreement-position", tenant, actor, receivable],
      });
      setRows([newRow()]);setHistoryOffset(0);
      await Promise.all([cache.invalidateQueries({queryKey:["receivable-agreement-history",tenant,actor,receivable]}),cache.invalidateQueries({queryKey:["finance-cash-forecast-preview",tenant]}),cache.invalidateQueries({queryKey:["finance-cash-forecast-agenda",tenant]}),cache.invalidateQueries({queryKey:["finance-cash-forecast-sources",tenant]})]);
    } catch (cause) {
      setError(receivableAgreementError(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Renegociar saldo em aberto</DialogTitle>
          <DialogDescription>
            As parcelas distribuem o saldo do título original. Não criam novos
            títulos, não movimentam dinheiro e preservam todas as versões.
          </DialogDescription>
        </DialogHeader>
        {positionQuery.isPending ? (
          <p role="status">Consultando posição financeira…</p>
        ) : null}
        {positionQuery.error ? (
          <div role="alert" className="space-y-2">
            <p>{receivableAgreementError(positionQuery.error)}</p>
            <Button
              type="button"
              variant="outline"
              disabled={positionQuery.isFetching}
              onClick={() => void positionQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : null}
        {position && (
          <>
            <div className="rounded border p-3">
              <p>
                Saldo aberto:{" "}
                {position.open_cents === null
                  ? "não verificado"
                  : formatFinanceCents(position.open_cents)}
              </p>
              <p>
                Soma das parcelas vigentes:{" "}
                {position.scheduled_open_cents === null
                  ? "não verificada"
                  : formatFinanceCents(position.scheduled_open_cents)}
              </p>
              {position.requires_reallocation ? (
                <p role="alert">
                  Há{" "}
                  {formatFinanceCents(position.unallocated_open_cents || "0")}{" "}
                  sem parcela após uma reversão. Revise o acordo.
                </p>
              ) : null}
            </div>
            {position.installments.length ? (
              <div>
                <h3 className="font-semibold">Parcelas vigentes</h3>
                <ol className="list-decimal pl-5">
                  {position.installments.map((row) => (
                    <li key={row.id}>
                      {new Date(row.due_on + "T12:00:00").toLocaleDateString(
                        "pt-BR",
                      )}{" "}
                      · aberto{" "}
                      {row.open_cents === null
                        ? "não verificado"
                        : formatFinanceCents(row.open_cents)}{" "}
                      · {row.status}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {historyQuery.isPending&&<p role="status">Carregando histórico das versões…</p>}
            {historyQuery.isError&&<p role="alert">Não foi possível carregar o histórico. <Button type="button" variant="outline" onClick={()=>void historyQuery.refetch()}>Tentar novamente</Button></p>}
            {historyQuery.data&&<div className="flex gap-2"><Button variant="outline" disabled={historyOffset===0||historyQuery.isFetching} onClick={()=>setHistoryOffset(Math.max(0,historyOffset-30))}>Versões anteriores</Button><span>{historyQuery.data.total===0?0:historyOffset+1}–{Math.min(historyOffset+historyQuery.data.rows.length,historyQuery.data.total)} de {historyQuery.data.total}</span><Button variant="outline" disabled={historyQuery.data.next_offset===null||historyQuery.isFetching} onClick={()=>setHistoryOffset(historyQuery.data.next_offset??historyOffset)}>Próximas versões</Button></div>}
            <fieldset disabled={working || !!pending || !!recoveryError} className="space-y-3">
              <legend className="font-semibold">
                {action === "create" ? "Novo acordo" : "Nova versão do acordo"}
              </legend>
              {rows.map((row, index) => (
                <div
                  className="grid grid-cols-[1fr_1fr_auto] gap-2"
                  key={row.id}
                >
                  <label>
                    Valor da parcela {index + 1} (R$)
                    <Input
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => {
                        setRows((old) =>
                          old.map((item) =>
                            item.id === row.id
                              ? { ...item, amount: e.target.value }
                              : item,
                          ),
                        );
                        changed();
                      }}
                    />
                  </label>
                  <label>
                    Vencimento
                    <Input
                      type="date"
                      value={row.due}
                      onChange={(e) => {
                        setRows((old) =>
                          old.map((item) =>
                            item.id === row.id
                              ? { ...item, due: e.target.value }
                              : item,
                          ),
                        );
                        changed();
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Excluir parcela ${index + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => {
                      setRows((old) =>
                        old.filter((item) => item.id !== row.id),
                      );
                      changed();
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={rows.length >= 100}
                onClick={() => {
                  setRows((old) => [...old, newRow()]);
                  changed();
                }}
              >
                Adicionar parcela
              </Button>
              <p className="text-sm text-muted-foreground">{rows.length} de 100 parcelas.</p>
              <label className="block">
                Motivo da renegociação
                <Textarea
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    changed();
                  }}
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void check()}
                  disabled={!installments || reason.trim().length < 5}
                >
                  Gerar prévia
                </Button>
                {position.status === "active" ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void check("revoke")}
                    disabled={reason.trim().length < 5}
                  >
                    Conferir revogação
                  </Button>
                ) : null}
              </div>
            </fieldset>
            {pending ? (
              <div role="alert" className="rounded border border-amber-600 p-3">
                <p>
                  Existe um pedido preservado desta sessão. Recupere-o antes de
                  iniciar outro.
                </p>
                <Button disabled={working} onClick={() => void recover()}>
                  Recuperar pedido
                </Button>
              </div>
            ) : null}
            {recoveryError ? (
              <div role="alert" className="rounded border border-destructive p-3">
                <p>{recoveryError} Novas renegociações permanecem bloqueadas até o descarte.</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => {
                    try {
                      discardPendingReceivableAgreement(localStorage, tenant, actor);
                      setPending(null);
                      setPreview(null);
                      setRecoveryError("");
                      setError("");
                    } catch (cause) {
                      setError(receivableAgreementError(cause));
                    }
                  }}
                >
                  Descartar pedido incompatível
                </Button>
              </div>
            ) : null}
            {preview ? (
              <div className="rounded border p-3">
                <h3 className="font-semibold">
                  Prévia vinculada à revisão atual
                </h3>
                <p>
                  Saldo antes/depois:{" "}
                  {formatFinanceCents(
                    preview.data.effects.open_before_cents || "0",
                  )}{" "}
                  /{" "}
                  {formatFinanceCents(
                    preview.data.effects.open_after_cents || "0",
                  )}
                </p>
                <p>
                  Parcelas depois:{" "}
                  {formatFinanceCents(
                    preview.data.effects.scheduled_after_cents || "0",
                  )}
                </p>
                {preview.data.blockers.length ? (
                  <p role="alert">
                    {preview.data.blockers.map((row) => row.code).join(" · ")}
                  </p>
                ) : (
                  <Button
                    disabled={working || reason.trim().length < 5}
              onClick={() => void confirmAgreement()}
                  >
                    Confirmar versão auditada
                  </Button>
                )}
              </div>
            ) : null}
            {historyQuery.data ? (
              <details>
                <summary>
                  Histórico de versões ({historyQuery.data.total})
                </summary>
                <ol className="list-decimal pl-5">
                  {historyQuery.data.rows.map((row, index) => (
                    <li key={String(row.id || index)}>
                      {String(row.action || "evento")} ·{" "}
                      {String(row.created_at || "")}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </>
        )}
        {working ? (
          <p role="status">Processando com proteção contra reenvio…</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
