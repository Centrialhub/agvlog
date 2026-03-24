import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Upload, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ResultsStepProps {
  results: string[];
  onReset: () => void;
}

export default function ResultsStep({ results, onReset }: ResultsStepProps) {
  const navigate = useNavigate();
  const successes = results.filter(r => r.startsWith('✅'));
  const errors = results.filter(r => r.startsWith('❌'));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3">
        <Card className="flex-1">
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-success" />
            <div>
              <div className="text-2xl font-bold text-success">{successes.length}</div>
              <div className="text-xs text-muted-foreground">Sucesso</div>
            </div>
          </CardContent>
        </Card>
        {errors.length > 0 && (
          <Card className="flex-1 border-destructive/30">
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <div>
                <div className="text-2xl font-bold text-destructive">{errors.length}</div>
                <div className="text-xs text-muted-foreground">Erros</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detail list */}
      <Card>
        <CardContent className="py-3">
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`text-sm py-1 px-2 rounded ${r.startsWith('✅') ? 'text-success' : 'text-destructive bg-destructive/5'}`}>
                {r}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={onReset}>
          <Upload className="h-4 w-4 mr-2" /> Nova Importação
        </Button>
        <Button onClick={() => navigate('/loads')}>
          Ver Cargas <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
