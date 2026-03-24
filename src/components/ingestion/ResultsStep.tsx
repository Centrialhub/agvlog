import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Upload } from 'lucide-react';

interface ResultsStepProps {
  results: string[];
  onReset: () => void;
}

export default function ResultsStep({ results, onReset }: ResultsStepProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-success" /> Resultado da Importação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className={`text-sm py-1 ${r.startsWith('✅') ? 'text-success' : 'text-destructive'}`}>{r}</div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex gap-3 justify-center">
        <Button onClick={onReset}><Upload className="h-4 w-4 mr-2" /> Nova Importação</Button>
      </div>
    </div>
  );
}
