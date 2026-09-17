export const CHART_COLORS = [
  'hsl(215, 80%, 48%)', 'hsl(142, 64%, 38%)', 'hsl(38, 92%, 50%)',
  'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(180, 60%, 40%)',
  'hsl(320, 65%, 50%)', 'hsl(25, 85%, 55%)',
];

export const LOAD_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada', assembling: 'Montando', ready: 'Pronta',
  loading: 'Carregando', loaded: 'Carregada', in_transit: 'Em Trânsito',
  delivered: 'Entregue', divergent: 'Divergente',
};

export const LOAD_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  loading: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  loaded: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  divergent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

export const INCIDENT_SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
  high: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400',
  medium: 'bg-warning/15 text-warning border-warning/30',
  low: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
};

export function formatOperationsCurrency(value: number) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatOperationsWeight(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}t` : `${value.toFixed(0)}kg`;
}

export function displayOperationsValue(pending: boolean, unavailable: boolean, value: string | number) {
  return pending ? '…' : unavailable ? '—' : value;
}
