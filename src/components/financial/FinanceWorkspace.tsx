import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PendingFinanceOperations } from "./PendingFinanceOperations";
import { FinanceSurfaceContext } from "@/components/ui/finance-surface-context";
import { financeRouteDestinations } from "@/lib/financial/financeRoutes";
import "./finance-workspace.css";

export function FinanceWorkspace({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const groups = [
    {
      label: "Dia a dia",
      routes: [
        "/financial",
        "/receivables",
        "/payables",
        "/financial/movements",
        "/financial/recorded-expenses",
        "/bank-reconciliation",
      ],
    },
    {
      label: "Cobrança",
      routes: [
        "/client-invoices",
        "/billing-edi",
        "/closing-reports",
        "/financial/fiscal-queue",
      ],
    },
    {
      label: "Conferência e gestão",
      routes: [
        "/financial/statements",
        "/financial/audit",
        "/financial/cash-forecast",
        "/expense-approval",
        "/cost-centers",
        "/payroll",
        "/driver-settlements",
      ],
    },
  ];
  return (
    <FinanceSurfaceContext.Provider value={true}>
      <div className="finance-workspace min-w-0 space-y-6">
        <nav
          aria-label="Áreas do financeiro"
          className="grid gap-2 rounded-xl border bg-muted/30 p-2 md:grid-cols-3"
        >
          {groups.map((group) => (
            <details
              key={`${group.label}:${pathname}`}
              open={group.routes.includes(pathname)}
              className="rounded border p-2"
            >
              <summary className="cursor-pointer font-medium">
                {group.label}
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {financeRouteDestinations
                  .filter(([to]) => group.routes.includes(to))
                  .map(([to, label]) => (
                    <NavLink
                      key={to}
                      to={to}
                      end
                      className={({ isActive }) =>
                        `shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`
                      }
                    >
                      {label}
                    </NavLink>
                  ))}
              </div>
            </details>
          ))}
        </nav>
        <PendingFinanceOperations />
        {children}
      </div>
    </FinanceSurfaceContext.Provider>
  );
}
