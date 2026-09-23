import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatFinanceCents } from "@/lib/financial/ledgerContract";
import { readReceivablePaymentInstallments, ReceivablePaymentInstallmentsChangedError } from "@/lib/financial/receivablePaymentInstallments";
export function ReceivablePaymentInstallments({
  tenant,
  actor,
  receivable,
  payment,
}: {
  tenant: string;
  actor: string;
  receivable: string;
  payment: string;
}) {
  const [page, setPage] = useState({
      offset: 0,
      revision: null as string | null,
    }),
    query = useQuery({
      queryKey: [
        "receivable-payment-installments",
        tenant,
        actor,
        receivable,
        payment,
        page,
      ],
      queryFn: () =>
        readReceivablePaymentInstallments(
          tenant,
          actor,
          receivable,
          payment,
          page.offset,
          page.revision,
        ),
      retry: false,
    }),
    data = query.data;
  if (query.isPending || query.isFetching)
    return <p role="status">Consultando distribuição por parcela…</p>;
  if (query.error) {
    const changed = query.error instanceof ReceivablePaymentInstallmentsChangedError;
    const canReset = page.offset > 0 || page.revision !== null;
    return (
      <div role="alert">
        <p>{changed ? 'A distribuição mudou enquanto você navegava.' : 'Não foi possível conferir a distribuição deste recebimento.'}</p>
        <Button variant="outline" onClick={() => { if (canReset) setPage({ offset: 0, revision: null }); else void query.refetch(); }}>
          {canReset ? 'Voltar à primeira página das distribuições' : 'Tentar consultar distribuições novamente'}
        </Button>
      </div>
    );
  }
  if (!data?.total)
    return (
      <p>Este recebimento não possui distribuição por parcela registrada.</p>
    );
  return (
    <section aria-label="Distribuição histórica por parcela">
      <p>{data.total} evento(s) de distribuição</p>
      <ol className="list-decimal pl-5">
        {data.rows.map((row) => (
          <li key={row.id}>
            {row.action === "allocate" ? "Alocado" : "Restaurado"}{" "}
            {formatFinanceCents(row.amount_cents)} · parcela {row.ordinal} ·
            vencimento{" "}
            {new Date(row.due_on + "T12:00:00").toLocaleDateString("pt-BR")}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!data.offset}
          onClick={() =>
            setPage({
              offset: Math.max(0, data.offset - data.limit),
              revision: data.revision,
            })
          }
        >
          Distribuições anteriores
        </Button>
        <Button
          variant="outline"
          disabled={data.next_offset === null}
          onClick={() =>
            setPage({ offset: data.next_offset || 0, revision: data.revision })
          }
        >
          Próximas distribuições
        </Button>
      </div>
    </section>
  );
}
