import { Clock, FileText, MapPin, Moon, PackageCheck, Sun, Sunrise } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useBrasiliaClock } from './useBrasiliaClock';

export function OperationsCenterHeader({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user } = useAuth();
  const { time, date, hour, greeting, dailyQuote } = useBrasiliaClock();
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Operador';
  const GreetingIcon = hour >= 5 && hour < 12 ? Sunrise : hour >= 12 && hour < 18 ? Sun : Moon;
  const greetingIconClass = hour >= 5 && hour < 12
    ? 'text-amber-400'
    : hour >= 12 && hour < 18 ? 'text-amber-500' : 'text-indigo-400';

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/3 to-accent/5" />
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/5 blur-2xl" />
      <div className="absolute -bottom-12 -left-12 w-36 h-36 rounded-full bg-accent/5 blur-2xl" />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-sm">
            <GreetingIcon className={`h-5 w-5 ${greetingIconClass}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {greeting}, <span className="text-primary">{userName}</span>
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 capitalize">{date}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1 italic max-w-md">"{dailyQuote}"</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end mr-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Brasília</span>
            </div>
            <p className="text-2xl font-mono font-bold text-foreground tracking-wider tabular-nums mt-0.5">{time}</p>
          </div>
          <div className="h-10 w-px bg-border hidden md:block" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onNavigate('/ingestion')}>
              <FileText className="h-4 w-4 mr-1" /> Importar
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('/route-planning')}>
              <MapPin className="h-4 w-4 mr-1" /> Roteirizar
            </Button>
            <Button size="sm" onClick={() => onNavigate('/loads')}>
              <PackageCheck className="h-4 w-4 mr-1" /> Cargas
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
