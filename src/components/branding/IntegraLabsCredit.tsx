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
        'flex shrink-0 items-center justify-center gap-2 text-center text-[10px] leading-none',
        tone === 'sidebar'
          ? 'text-sidebar-foreground/70'
          : 'text-muted-foreground',
        className,
      )}
    >
      <span className="font-medium whitespace-nowrap">Desenvolvido por</span>
      {/* Frame the horizontal artwork within the original square, transparent canvas. */}
      <span className="relative block h-6 w-[100px] shrink-0 overflow-hidden">
        <img
          src="/assets/integra-labs-horizontal.png"
          alt="Integra Labs"
          width={2000}
          height={2000}
          className={cn(
            'absolute left-0 top-1/2 h-[100px] w-[100px] max-w-none -translate-y-1/2 object-contain',
            tone === 'default' && 'brightness-50 grayscale',
          )}
        />
      </span>
    </div>
  );
}
