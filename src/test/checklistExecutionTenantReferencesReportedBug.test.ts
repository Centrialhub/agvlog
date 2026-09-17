import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260917152000_validate_checklist_execution_tenant_references.sql"),
  "utf8",
);

describe("reported checklist execution tenant reference bug", () => {
  it("validates every tenant-qualified foreign key for historical rows", () => {
    const constraints = [
      "checklist_executions_tenant_checklist_fkey",
      "checklist_executions_tenant_vehicle_fkey",
      "checklist_executions_tenant_employee_fkey",
      "checklist_executions_tenant_trip_fkey",
      "checklist_executions_tenant_incident_fkey",
      "checklist_executions_tenant_maintenance_fkey",
    ];

    for (const constraint of constraints) {
      expect(migration).toContain(`validate constraint ${constraint}`);
    }
  });
});
