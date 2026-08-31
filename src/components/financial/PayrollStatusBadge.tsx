import { Badge } from '@/components/ui/badge';
import { PAYROLL_PERIOD_STATUS_LABELS, type PayrollPeriodStatus } from '@/hooks/usePayroll';

const statusStyles: Record<PayrollPeriodStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  calculated: 'bg-blue-500/10 text-blue-600',
  under_review: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-green-500/10 text-green-600',
  closed: 'bg-slate-500/10 text-slate-600',
  cancelled: 'bg-red-500/10 text-red-600',
};

export function PayrollStatusBadge({ status }: { status: string }) {
  const known = Object.prototype.hasOwnProperty.call(statusStyles, status);
  const style = known ? statusStyles[status as PayrollPeriodStatus] : '';
  const label = known ? PAYROLL_PERIOD_STATUS_LABELS[status as PayrollPeriodStatus] : status;
  return <Badge variant="outline" className={`text-[10px] ${style}`}>{label}</Badge>;
}
