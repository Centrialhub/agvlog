import { useState } from 'react';
import { Check, Navigation, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  NAVIGATION_APPS,
  NAVIGATION_APP_LABELS,
  openNavigation,
  readNavigationPreference,
  saveNavigationPreference,
  type NavigationApp,
  type NavigationDestination,
} from '@/lib/driver/navigation';

interface NavigationLauncherProps {
  destination: NavigationDestination;
  className?: string;
  compact?: boolean;
}

export function NavigationLauncher({ destination, className, compact = false }: NavigationLauncherProps) {
  const [preference, setPreference] = useState<NavigationApp | null>(() => readNavigationPreference());
  const [chooserOpen, setChooserOpen] = useState(false);

  const launch = (app: NavigationApp) => {
    saveNavigationPreference(app);
    setPreference(app);
    setChooserOpen(false);
    openNavigation(app, destination);
  };

  const handlePrimaryAction = () => {
    if (preference) launch(preference);
    else setChooserOpen(true);
  };

  return (
    <>
      <div className={cn('flex gap-2', className)}>
        <Button
          type="button"
          size={compact ? 'sm' : 'lg'}
          className={cn('flex-1 font-semibold', !compact && 'h-12 text-base')}
          onClick={handlePrimaryAction}
          aria-label="Abrir navegação"
        >
          <Navigation className={cn('mr-2', compact ? 'h-4 w-4' : 'h-5 w-5')} />
          Abrir navegação
        </Button>
        {preference && (
          <Button
            type="button"
            size={compact ? 'sm' : 'lg'}
            variant="outline"
            className={cn(!compact && 'h-12 w-12 px-0')}
            onClick={() => setChooserOpen(true)}
            aria-label={`Alterar aplicativo de navegação. Atual: ${NAVIGATION_APP_LABELS[preference]}`}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Como você quer navegar?</DialogTitle>
            <DialogDescription>
              Escolha uma vez. Você poderá trocar pelo botão ao lado da navegação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            {NAVIGATION_APPS.map((app) => (
              <Button
                key={app}
                type="button"
                variant="outline"
                className="h-12 w-full justify-between text-sm"
                onClick={() => launch(app)}
              >
                <span>{NAVIGATION_APP_LABELS[app]}</span>
                {preference === app && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
              </Button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">Preferência salva somente neste aparelho.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
