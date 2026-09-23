import { beforeEach, expect, it, vi } from "vitest";
import {
  createDurableDecisionStorage,
  withFinancialDecisionLock,
} from "@/lib/financial/durableDecisionStorage";
import { listStoredOperations } from "@/lib/financial/pendingOperations";
import {
  manualTitleKey,
  readManualTitle,
  saveManualTitle,
} from "@/lib/financial/manualTitleCommand";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mock.rpc },
}));
const tenant = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  key = `finance-account-period-decision:${tenant}:${actor}:${crypto.randomUUID()}`;
let durableDecisionStorage: ReturnType<typeof createDurableDecisionStorage>;
beforeEach(() => {
  durableDecisionStorage = createDurableDecisionStorage();
  localStorage.clear();
  sessionStorage.clear();
  mock.rpc.mockReset();
  let previous = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_key: string, work: () => Promise<unknown>) => {
        const next = previous.then(work);
        previous = next.then(
          () => {},
          () => {},
        );
        return next;
      },
    },
  });
});
it("migrates an existing session decision without changing its bytes and survives a closed tab", () => {
  const raw = JSON.stringify({ request_id: crypto.randomUUID() });
  sessionStorage.setItem(key, raw);
  expect(durableDecisionStorage.getItem(key)).toBe(raw);
  sessionStorage.clear();
  expect(durableDecisionStorage.getItem(key)).toBe(raw);
  expect(() => durableDecisionStorage.setItem(key, "different")).toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
});
it("does not erase another tab’s different request", async () => {
  await withFinancialDecisionLock(key, async () => {
    durableDecisionStorage.setItem(key, "original");
    localStorage.setItem(key, "another");
    expect(() => durableDecisionStorage.removeItem(key)).toThrow();
  });
  expect(localStorage.getItem(key)).toBe("another");
});
it("does not let a second mounted reader replace the ownership of an in-flight command", () => {
  durableDecisionStorage.setItem(key, "original");
  localStorage.setItem(key, "another");
  expect(createDurableDecisionStorage().getItem(key)).toBe("another");
  expect(() => durableDecisionStorage.removeItem(key)).toThrow();
  expect(localStorage.getItem(key)).toBe("another");
});
it("replays exactly the title command after a lost response and clears only a matching acknowledgement", async () => {
  const fields = {
    amount: 100,
    description: "Frete de teste",
    status: "pending",
  };
  mock.rpc.mockRejectedValueOnce(Error("Conexão interrompida"));
  await expect(
    saveManualTitle(tenant, actor, "receivable", fields),
  ).rejects.toThrow();
  const pending = readManualTitle(tenant, actor, "receivable")!;
  expect(pending.fields).toEqual(fields);
  sessionStorage.clear();
  mock.rpc.mockResolvedValueOnce({
    data: {
      version: 1,
      tenant_id: tenant,
      request_id: pending.request_id,
      confirmed: true,
      kind: "receivable",
      record: { id: crypto.randomUUID(), tenant_id: tenant },
    },
    error: null,
  });
  await saveManualTitle(tenant, actor, "receivable");
  expect(mock.rpc.mock.calls[1][1]).toEqual({ _payload: pending });
  expect(
    localStorage.getItem(manualTitleKey(tenant, actor, "receivable")),
  ).toBeNull();
});
it("serializes two tabs recovering the same request and refuses changed data while uncertain", async () => {
  mock.rpc.mockRejectedValue(Error("Timeout"));
  await expect(
    saveManualTitle(tenant, actor, "payable", { amount: 100 }),
  ).rejects.toThrow();
  await expect(
    saveManualTitle(tenant, actor, "payable", { amount: 200 }),
  ).rejects.toThrow("Há um salvamento");
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  const pending = readManualTitle(tenant, actor, "payable")!;
  mock.rpc.mockResolvedValue({
    data: {
      version: 1,
      tenant_id: tenant,
      request_id: pending.request_id,
      confirmed: true,
      kind: "payable",
      record: { id: crypto.randomUUID(), tenant_id: tenant },
    },
    error: null,
  });
  const results = await Promise.allSettled([
    saveManualTitle(tenant, actor, "payable"),
    saveManualTitle(tenant, actor, "payable"),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(mock.rpc).toHaveBeenCalledTimes(2);
});
it("does not expose recovery entries belonging to another actor or company", () => {
  localStorage.setItem(key, "{}");
  localStorage.setItem(
    `finance-reconciliation:${tenant}:${crypto.randomUUID()}:record`,
    "{}",
  );
  localStorage.setItem(
    `finance-reconciliation:${crypto.randomUUID()}:${actor}:record`,
    "{}",
  );
  expect(listStoredOperations(localStorage, tenant, actor, true)).toHaveLength(
    1,
  );
});

it("lets each mounted decision clear only its own original request", () => {
  const first = createDurableDecisionStorage(),
    second = createDurableDecisionStorage();
  first.setItem(key, "first");
  expect(second.getItem(key)).toBe("first");
  first.removeItem(key);
  first.setItem(key, "second");
  expect(() => second.removeItem(key)).toThrow();
  expect(localStorage.getItem(key)).toBe("second");
  first.removeItem(key);
  expect(localStorage.getItem(key)).toBeNull();
});
it("refuses unknown ownership and preserves conflicting legacy recovery", () => {
  localStorage.setItem(key, "durable");
  sessionStorage.setItem(key, "legacy");
  const decision = createDurableDecisionStorage();
  expect(() => decision.getItem(key)).toThrow();
  expect(() => decision.removeItem(key)).toThrow();
  expect(localStorage.getItem(key)).toBe("durable");
  expect(sessionStorage.getItem(key)).toBe("legacy");
});
it("removes matching migrated session data so it cannot resurrect after confirmation", () => {
  localStorage.setItem(key, "original");
  sessionStorage.setItem(key, "original");
  const decision = createDurableDecisionStorage();
  expect(decision.getItem(key)).toBe("original");
  expect(sessionStorage.getItem(key)).toBeNull();
  decision.removeItem(key);
  expect(createDurableDecisionStorage().getItem(key)).toBeNull();
});
