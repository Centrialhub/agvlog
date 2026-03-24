import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function DriverIssues() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Ocorrências</h1>
      <Card>
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Registre ocorrências da viagem aqui.</p>
        </CardContent>
      </Card>
    </div>
  );
}
