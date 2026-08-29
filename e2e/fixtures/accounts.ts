export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

export const accounts = {
  owner: { email: "owner@agvlog-e2e.invalid", password: E2E_PASSWORD },
  admin: { email: "admin@agvlog-e2e.invalid", password: E2E_PASSWORD },
  operator: { email: "operator@agvlog-e2e.invalid", password: E2E_PASSWORD },
  driver: { email: "driver@agvlog-e2e.invalid", password: E2E_PASSWORD },
  client: { email: "client@agvlog-e2e.invalid", password: E2E_PASSWORD },
  tenantB: { email: "tenant-b@agvlog-e2e.invalid", password: E2E_PASSWORD },
  multiOperator: { email: "multi-operator@agvlog-e2e.invalid", password: E2E_PASSWORD },
} as const;

export const fixtureIds = {
  tenantA: "20000000-0000-4000-8000-000000000001",
  tenantB: "20000000-0000-4000-8000-000000000002",
  clientA: "40000000-0000-4000-8000-000000000001",
  clientB: "40000000-0000-4000-8000-000000000002",
  loadA: "70000000-0000-4000-8000-000000000001",
  loadB: "70000000-0000-4000-8000-000000000002",
  vehicleA: "50000000-0000-4000-8000-000000000001",
  tripA: "80000000-0000-4000-8000-000000000001",
  stopA: "82000000-0000-4000-8000-000000000001",
  fiscalDocumentA: "90000000-0000-4000-8000-000000000001",
  occurrenceA: "92000000-0000-4000-8000-000000000001",
  operationalEventA: "93000000-0000-4000-8000-000000000001",
} as const;
