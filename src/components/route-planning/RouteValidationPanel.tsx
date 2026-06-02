import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { RoutePlanValidationIssue } from '@/lib/route-planning/routePlanningTypes';

export default function RouteValidationPanel({ issues }: { issues: RoutePlanValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
        <CheckCircle2 className="h-4 w-4" /> Rota pronta para despacho.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {issues.map((i, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 border ${
            i.level === 'error'
              ? 'bg-destructive/10 text-destructive border-destructive/30'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          <AlertTriangle className="h-3 w-3" /> {i.message}
        </div>
      ))}
    </div>
  );
}
