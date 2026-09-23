import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { statementImportStore } from "@/lib/financial/statementImportStore";
import {
  listStoredOperations,
  type PendingOperation,
} from "@/lib/financial/pendingOperations";
import { Button } from "@/components/ui/button";
export function PendingFinanceOperations() {
  const { currentTenant, currentRole } = useTenant(),
    { user } = useAuth();
  return currentTenant &&
    user &&
    ["owner", "admin", "operator"].includes(currentRole || "") ? (
    <PendingList
      key={`${currentTenant.id}:${user.id}`}
      tenant={currentTenant.id}
      actor={user.id}
    />
  ) : null;
}
function PendingList({ tenant, actor }: { tenant: string; actor: string }) {
  const [rows, setRows] = useState<PendingOperation[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function sync() {
      let next: PendingOperation[] = [];
      let message = "";
      try {
        const durable = listStoredOperations(localStorage, tenant, actor, true),
          session = listStoredOperations(sessionStorage, tenant, actor, false);
        next = [
          ...durable,
          ...session.filter((row) => !durable.some((d) => d.key === row.key)),
        ];
        if (typeof indexedDB !== "undefined") {
          const statement = await statementImportStore.load(tenant, actor);
          if (statement)
            next.push({
              key: "statement-import",
              label: "Importação de extrato",
              route: "/bank-reconciliation",
              persistent: true,
              reference: statement.file_name,
            });
        }
      } catch {
        message =
          "Não foi possível consultar todos os pedidos salvos neste navegador.";
      }
      if (active) {
        setRows(next);
        setError(message);
      }
    }
    const refresh = () => void sync();
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("finance-operations-updated", refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("finance-operations-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [tenant, actor]);
  if (!rows.length && !error) return null;
  return (
    <details className="rounded border border-amber-600 p-3">
      <summary>
        Pedidos e rascunhos salvos neste navegador ({rows.length})
      </summary>
      <p className="mt-2 text-sm">
        Retome a operação na tela de origem antes de iniciar outro pedido. Esta
        lista mostra os registros locais da sua sessão e empresa; não comprova
        que o banco confirmou a operação.
      </p>
      {error && <p role="alert">{error}</p>}
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-2">
            <span>
              {row.label}
              {row.reference && ` · ${row.reference}`} ·{" "}
              {row.persistent
                ? "Preservado após fechar a aba"
                : "Disponível somente nesta aba"}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to={row.route}>Abrir origem</Link>
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
