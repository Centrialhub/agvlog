import { cn } from '@/lib/utils';

interface IntegraLabsCreditProps {
  className?: string;
  tone?: 'default' | 'sidebar';
}

export function IntegraLabsCredit({
  className,
  tone = 'default',
}: IntegraLabsCreditProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 text-center text-[10px] leading-none tracking-[0.08em]',
        tone === 'sidebar'
          ? 'text-sidebar-foreground/45'
          : 'text-muted-foreground/55',
        className,
      )}
    >
      <span className="font-medium whitespace-nowrap">Desenvolvido por</span>
      <img
        src="/assets/integra-labs-logo.png"
        alt="Integra Labs"
        className="h-4 w-auto object-contain opacity-70"
      />
    </div>
  );
}
