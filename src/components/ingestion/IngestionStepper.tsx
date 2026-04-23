import { ArrowRight, Check } from 'lucide-react';

const STEPS = ['Upload', 'Revisão ORT', 'Validação', 'Roteirização', 'Agrupamento', 'Resultado'] as const;

interface IngestionStepperProps {
  currentStep: number;
}

export default function IngestionStepper({ currentStep }: IngestionStepperProps) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            i === currentStep ? 'bg-primary text-primary-foreground' :
            i < currentStep ? 'bg-success/15 text-success' :
            'bg-muted text-muted-foreground'
          }`}>
            {i < currentStep ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-background/20">{i + 1}</span>
            )}
            {s}
          </div>
          {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );
}
