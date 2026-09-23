import { useEffect, useState } from 'react';
import { localDateInputValue } from '@/lib/utils/formatDate';

const CIVIL_CLOCK_INTERVAL_MS = 30_000;

/** Mantém a data civil atualizada mesmo quando a tela permanece aberta na virada do dia. */
export function useCivilDay(timeZone: string): string {
  const [day, setDay] = useState(() => localDateInputValue(new Date(), timeZone));

  useEffect(() => {
    const refresh = () => {
      const next = localDateInputValue(new Date(), timeZone);
      setDay(current => current === next ? current : next);
    };
    refresh();
    const interval = window.setInterval(refresh, CIVIL_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [timeZone]);

  return day;
}
