/** Preserve exact commands when a tab closes; migrate older session drafts on first read. */
const changed = () =>
  window.dispatchEvent(new Event("finance-operations-updated"));
// Ownership belongs to one mounted decision, never to every reader of the same key.
export function createDurableDecisionStorage() {
  const observed = new Map<string, string | null>();
  function read(key: string) {
    const durable = localStorage.getItem(key),
      legacy = sessionStorage.getItem(key);
    if (durable !== null && legacy !== null && durable !== legacy)
      throw new Error(
        "Há dois pedidos diferentes. Preserve as abas e confira o histórico antes de continuar.",
      );
    if (durable === null && legacy !== null) {
      localStorage.setItem(key, legacy);
      changed();
    }
    if (legacy !== null) sessionStorage.removeItem(key);
    return durable ?? legacy;
  }
  return {
    getItem(key: string) {
      const value = read(key);
      observed.set(key, value);
      return value;
    },
    setItem(key: string, value: string) {
      const prior = read(key);
      if (prior !== null && prior !== value)
        throw new Error(
          "Já existe um pedido sem confirmação. Reabra a conferência para retomar o original.",
        );
      localStorage.setItem(key, value);
      observed.set(key, value);
      changed();
    },
    removeItem(key: string) {
      const current = localStorage.getItem(key);
      const legacy = sessionStorage.getItem(key);
      if (
        !observed.has(key) ||
        observed.get(key) !== current ||
        (legacy !== null && legacy !== current)
      )
        throw new Error("O pedido mudou em outra aba. Reabra a conferência.");
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      observed.delete(key);
      changed();
    },
  };
}
export async function withFinancialDecisionLock<T>(
  key: string,
  work: () => Promise<T>,
) {
  if (!navigator.locks)
    throw new Error(
      "Atualize o navegador para proteger esta decisão entre abas.",
    );
  return navigator.locks.request(key, work);
}
