import { FiscalEvidencePreview } from "@/components/financial/FiscalEvidencePreview";
import { FiscalReviewAssignment } from "@/components/financial/FiscalReviewAssignment";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useFinanceAccess } from "@/hooks/useFinanceLedger";
import { readFiscalWorkQueue } from "@/lib/financial/ledgerClient";
import { useListFilters } from "@/hooks/useListFilters";
import {
  fiscalQueueIssue,
  fiscalQueueStatuses,
  type FiscalQueueCursor,
  type FiscalQueueStatus,
} from "@/lib/financial/fiscalQueueContract";
import { Button } from "@/components/ui/button";
const timestamp = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
export default function FinanceFiscalQueue() {
  const { currentTenant, currentRole } = useTenant(),
    { user } = useAuth(),
    access = useFinanceAccess();
  if (!currentTenant || !user) return <p>Entre e selecione a empresa.</p>;
  if (!["owner", "admin", "operator"].includes(currentRole || ""))
    return <p role="alert">Acesso financeiro não permitido.</p>;
  if (access.isPending) return <p role="status">Verificando acesso…</p>;
  if (access.error)
    return (
      <p role="alert">
        Não foi possível verificar o acesso.{" "}
        <Button onClick={() => void access.refetch()}>Tentar novamente</Button>
      </p>
    );
  if (!access.data) return <p role="alert">Acesso financeiro não permitido.</p>;
  return (
    <QueueWorkspace
      key={`${currentTenant.id}:${user.id}`}
      tenant={currentTenant.id}
      actor={user.id}
    />
  );
}
function QueueWorkspace({ tenant, actor }: { tenant: string; actor: string }) {
  const { filters, setFilter } = useListFilters(
    { status: "review", scope: "current" },
    "fiscal_",
  );
  const status = filters.status as FiscalQueueStatus,
    currentOnly = filters.scope !== "history";
  const [cursors, setCursors] = useState<Array<FiscalQueueCursor | null>>([
    null,
  ]);
  const scope = `${status}:${currentOnly}`;
  const [cursorScope, setCursorScope] = useState(scope);
  useEffect(() => {
    setCursors([null]);
    setCursorScope(scope);
  }, [scope]);
  const setStatus = (value: FiscalQueueStatus) => setFilter("status", value);
  const cursor = cursorScope === scope ? cursors[cursors.length - 1] : null;
  const query = useQuery({
      queryKey: [
        "finance-fiscal-queue",
        tenant,
        actor,
        status,
        currentOnly,
        cursor,
      ],
      retry: false,
      refetchInterval: 30000,
      queryFn: () => readFiscalWorkQueue(tenant, status, cursor, currentOnly),
    }),
    data = query.error || query.isFetching ? undefined : query.data;
  useEffect(() => {
    if (data && data.rows.length === 0 && cursors.length > 1)
      setCursors((current) => current.slice(0, -1));
  }, [data, cursors.length]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Recebíveis fiscais</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe a geração e a atualização das cobranças de CT-e e NFS-e.
          Processado não significa recebido ou conciliado com o banco.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Situação
          <select
            className="block h-10 rounded border bg-background px-3"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FiscalQueueStatus);
              setCursors([null]);
            }}
          >
            <option value="">Todas</option>
            {Object.entries(fiscalQueueStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exibição
          <select
            className="block h-10 rounded border bg-background px-3"
            value={filters.scope}
            onChange={(e) => {
              setFilter("scope", e.target.value);
              setCursors([null]);
            }}
          >
            <option value="current">Situação atual por documento</option>
            <option value="history">Histórico de observações</option>
          </select>
        </label>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Atualizar
        </Button>
      </div>
      {query.isPending && <p role="status">Consultando processamento…</p>}
      {query.error && (
        <p role="alert">
          Não foi possível consultar o processamento. Tente atualizar.
        </p>
      )}
      {data && (
        <>
          {!data.scheduler_active && (
            <p role="alert">
              O processamento automático não está ativo. Solicite a ativação
              para que os documentos pendentes sejam processados.
            </p>
          )}
          <p>Indicadores de todas as situações na exibição selecionada.</p>
          <dl className="grid gap-3 sm:grid-cols-4">
            {Object.entries(data.counts).map(([key, value]) => (
              <div key={key} className="rounded border p-3">
                <dt>
                  {fiscalQueueStatuses[key as keyof typeof fiscalQueueStatuses]}
                </dt>
                <dd className="text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            {data.total}{" "}
            {currentOnly
              ? "documento(s) atual(is)"
              : "observação(ões) histórica(s)"}{" "}
            no filtro. Horários de Brasília. Após corrigir os dados na origem,
            confira o resultado do processamento automático nesta fila.
          </p>
          <div className="space-y-3">
            {data.rows.map((row) => (
              <article
                key={row.observation_id}
                className={`rounded border p-4 ${row.status === "review" ? "border-amber-600" : ""}`}
              >
                <p className="font-semibold">
                  {row.document_type === "cte" ? "CT-e" : "NFS-e"}{" "}
                  {row.document_number || "sem número"} ·{" "}
                  {fiscalQueueStatuses[row.status]}
                </p>
                <p className="text-sm">
                  Registrado em {timestamp(row.created_at)} · Atualizado em{" "}
                  {timestamp(row.updated_at)}
                </p>
                <p className="text-sm">
                  Idade deste registro:{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - Date.parse(row.created_at)) / 86400000,
                    ),
                  )}{" "}
                  dia(s).
                </p>
                {row.issue && (
                  <p className="mt-2">{fiscalQueueIssue(row.issue)}</p>
                )}
                {row.status === "pending" && row.automatic_failures > 0 && (
                  <p className="text-sm">
                    Próxima tentativa a partir de {timestamp(row.available_at)}.
                  </p>
                )}
                <p className="text-sm">
                  {row.attempts} tentativa(s) · {row.automatic_failures}{" "}
                  falha(s) automática(s)
                </p>
                <FiscalEvidencePreview
                  tenant={tenant}
                  actor={actor}
                  observation={row.observation_id}
                />
                <FiscalReviewAssignment
                  key={`${row.observation_id}:${row.assignment_revision}`}
                  tenant={tenant}
                  actor={actor}
                  row={row}
                />
              </article>
            ))}
            {!data.rows.length && <p>Nenhum registro neste filtro.</p>}
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              disabled={cursors.length === 1 || query.isFetching}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              Anterior
            </Button>
            <span>Página {cursors.length}</span>
            <Button
              variant="outline"
              disabled={!data.has_more || !data.next_cursor || query.isFetching}
              onClick={() =>
                data.next_cursor &&
                setCursors((current) => [...current, data.next_cursor])
              }
            >
              Próxima
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
