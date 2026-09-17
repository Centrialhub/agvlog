import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { formatFinanceCents } from "@/lib/financial/ledgerContract";
import { parseMoneyCents } from "@/lib/financial/receivableCommands";
import {
  readReceivableAgreementPosition,
  receivableAgreementError,
} from "@/lib/financial/receivableAgreementClient";
import type { ReceivableAgreementAllocation } from "@/lib/financial/receivableAgreementContract";

export type ReceivableAgreementDistribution =
  | {installment_allocations:ReceivableAgreementAllocation[];expected_agreement_revision:string}
  | {installment_allocations?:never;expected_agreement_revision?:never};
export function ReceivableInstallmentAllocationFields({
  tenant,
  actor,
  receivable,
  amountCents,
  enabled,
  onChange,
}: {
  tenant: string;
  actor: string;
  receivable: string;
  amountCents: string;
  enabled: boolean;
  onChange: (value: ReceivableAgreementDistribution | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const query = useQuery({
      queryKey: ["receivable-agreement-position", tenant, actor, receivable],
      queryFn: () => readReceivableAgreementPosition(tenant, actor, receivable),
      enabled,
      retry: false,
    }),
    position = query.data;
  useEffect(() => {
    if (!enabled) {
      onChange({});
      return;
    }
    if (query.error || !position) { onChange(null); return; }
    if (position.status !== "active") { onChange({}); return; }
    if (position.requires_reallocation) {
      onChange(null);
      return;
    }
    try {
      const items = position.installments.flatMap((row) =>
          values[row.id]?.trim()
            ? [
                {
                  installment_id: row.id,
                  amount_cents: String(parseMoneyCents(values[row.id])),
                },
              ]
            : [],
        ),
        sum = items.reduce(
          (total, row) => total + BigInt(row.amount_cents),
          0n,
        );
      onChange(
        sum === BigInt(amountCents)
          ? {
              installment_allocations: items,
              expected_agreement_revision: position.revision,
            }
          : null,
      );
    } catch {
      onChange(null);
    }
  }, [enabled, query.error, position, values, amountCents, onChange]);
  if (!enabled) return null;
  if (query.isPending || query.isFetching)
    return <p role="status">Consultando parcelas do acordo…</p>;
  if (query.error)
    return <p role="alert">{receivableAgreementError(query.error)}</p>;
  if (position?.status !== "active") return null;
  if (position.requires_reallocation)
    return (
      <p role="alert">
        Há saldo restaurado sem parcela. Revise o acordo antes desta operação.
      </p>
    );
  return (
    <fieldset className="space-y-2 rounded border p-3">
      <legend>Distribuição obrigatória entre parcelas</legend>
      {position.installments
        .filter((row) => row.open_cents !== "0")
        .map((row, index) => (
          <label className="block" key={row.id}>
            Parcela {index + 1} ·{" "}
            {new Date(row.due_on + "T12:00:00").toLocaleDateString("pt-BR")} ·
            saldo {formatFinanceCents(row.open_cents || "0")}
            <Input
              inputMode="decimal"
              aria-label={"Valor para parcela " + (index + 1)}
              value={values[row.id] || ""}
              onChange={(event) =>
                setValues((old) => ({ ...old, [row.id]: event.target.value }))
              }
            />
          </label>
        ))}
    </fieldset>
  );
}
