import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  readManualTitle,
  saveManualTitle,
  type ManualTitleKind,
  type ManualTitleCommand,
} from "@/lib/financial/manualTitleCommand";
export function ManualTitleRecovery({
  tenant,
  actor,
  kind,
  onRecorded,
}: {
  tenant: string;
  actor: string;
  kind: ManualTitleKind;
  onRecorded: () => void;
}) {
  const [pending, setPending] = useState<ManualTitleCommand | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    function read() {
      try {
        setPending(readManualTitle(tenant, actor, kind));
      } catch {
        setError(
          "A recuperação do cadastro precisa de revisão. Não repita a criação.",
        );
      }
    }
    read();
    window.addEventListener("storage", read);
    window.addEventListener("finance-operations-updated", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("finance-operations-updated", read);
    };
  }, [tenant, actor, kind]);
  if (!pending && !error) return null;
  async function recover() {
    setBusy(true);
    setError("");
    try {
      await saveManualTitle(tenant, actor, kind);
      await cache.invalidateQueries();
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível confirmar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded border border-amber-500 p-3 space-y-2"
      aria-label="Cadastro sem confirmação"
    >
      {pending && (
        <>
          <p>
            Salvamento de{" "}
            {kind === "payable" ? "conta a pagar" : "título a receber"} sem
            confirmação:{" "}
            {String(
              pending.fields.description ||
                pending.fields.supplier_name ||
                "Cadastro manual",
            )}
            .
          </p>
          <p>
            A retomada verifica o mesmo pedido e preserva os dados originais.
          </p>
          <Button disabled={busy} onClick={() => void recover()}>
            Retomar salvamento original
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
