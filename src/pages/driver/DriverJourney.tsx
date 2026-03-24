import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, Coffee, Moon, CheckCircle } from 'lucide-react';

type JourneyEvent = {
  type: string;
  label: string;
  time: Date;
};

const eventLabels: Record<string, { label: string; icon: typeof Play }> = {
  start_shift: { label: 'Início de Jornada', icon: Play },
  lunch: { label: 'Almoço', icon: Coffee },
  rest: { label: 'Descanso', icon: Coffee },
  overnight: { label: 'Pernoite', icon: Moon },
  resume: { label: 'Retomada', icon: Play },
  end_shift: { label: 'Fim de Jornada', icon: CheckCircle },
};

export default function DriverJourney() {
  const [events, setEvents] = useState<JourneyEvent[]>([]);

  const addEvent = (type: string) => {
    setEvents((prev) => [
      ...prev,
      { type, label: eventLabels[type]?.label || type, time: new Date() },
    ]);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Jornada</h1>

      <div className="grid grid-cols-2 gap-2">
        {Object.entries(eventLabels).map(([key, { label, icon: Icon }]) => (
          <Button
            key={key}
            variant="outline"
            size="sm"
            className="flex items-center gap-1.5 text-xs h-10"
            onClick={() => addEvent(key)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {events.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase">Linha do tempo</p>
            {events.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b last:border-0 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span>{e.label}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {e.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {events.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Registre os eventos da sua jornada.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
