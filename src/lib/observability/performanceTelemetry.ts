import { supabase } from '@/integrations/supabase/client';
import { getCorrelationId } from './correlation';

type MetricName = 'LCP' | 'CLS' | 'INP' | 'TTFB';
type Rating = 'good' | 'needs-improvement' | 'poor';

const RELEASE = import.meta.env.VITE_APP_RELEASE || 'development';
const latest = new Map<MetricName, number>();

function rating(name: MetricName, value: number): Rating {
  const thresholds: Record<MetricName, [number, number]> = {
    LCP: [2_500, 4_000],
    CLS: [0.1, 0.25],
    INP: [200, 500],
    TTFB: [800, 1_800],
  };
  const [good, poor] = thresholds[name];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

async function report(name: MetricName, value: number) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !Number.isFinite(value)) return;
  const correlationId = getCorrelationId();
  await supabase.functions.invoke('frontend-error-report', {
    headers: { 'x-correlation-id': correlationId },
    body: {
      kind: 'web_vital',
      correlation_id: correlationId,
      release: RELEASE,
      route: `${window.location.pathname}${window.location.search}`,
      metric_name: name,
      metric_value: Math.max(0, value),
      rating: rating(name, value),
    },
  });
}

export function installPerformanceTelemetry() {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation) latest.set('TTFB', navigation.responseStart);

  try {
    new PerformanceObserver((list) => {
      const entry = list.getEntries().at(-1);
      if (entry) latest.set('LCP', entry.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* browser does not expose LCP */ }

  try {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput) cls += entry.value ?? 0;
      }
      latest.set('CLS', cls);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* browser does not expose CLS */ }

  try {
    new PerformanceObserver((list) => {
      const duration = Math.max(...list.getEntries().map((entry) => entry.duration), 0);
      latest.set('INP', Math.max(latest.get('INP') ?? 0, duration));
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* browser does not expose event timing */ }

  const flush = () => {
    for (const [name, value] of latest) void report(name, value).catch(() => undefined);
    latest.clear();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush, { once: true });
}
