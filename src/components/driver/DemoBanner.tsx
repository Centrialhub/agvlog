import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DemoBannerProps {
  message?: string;
  onReset: () => void;
}

export default function DemoBanner({ message, onReset }: DemoBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">Modo demonstração.</span>{' '}
        {message || 'Dados fictícios para visualização — não são salvos no banco.'}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        onClick={onReset}
      >
        <RotateCcw className="h-3 w-3 mr-1" /> Resetar
      </Button>
    </div>
  );
}