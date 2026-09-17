import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileSpreadsheet, ShieldCheck, FileSearch } from 'lucide-react';
import Billing from '@/pages/BillingPage';
import CteMonitor from '@/pages/CteMonitor';
import CteSearch from '@/pages/CteSearch';

const VALID_TABS = new Set(['faturamento', 'monitor', 'consulta']);
const normalizeTab = (value: string | null) => value && VALID_TABS.has(value) ? value : 'faturamento';

export default function CteHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => normalizeTab(searchParams.get('tab')));

  // Mantém a aba sincronizada quando outras telas navegam para ?tab=monitor|consulta.
  useEffect(() => {
    const rawTab = searchParams.get('tab');
    const tab = normalizeTab(rawTab);
    setActiveTab(current => current === tab ? current : tab);
    if (rawTab !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const changeTab = (tab: string) => {
    const validTab = normalizeTab(tab);
    setActiveTab(validTab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', validTab);
    setSearchParams(next);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-primary" /> CT-e — Faturamento, Monitor e Consulta
        </h1>
        <p className="text-sm text-muted-foreground">
          Centralize a emissão, monitoramento e consulta de documentos CT-e em um único lugar.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="faturamento" className="gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Faturamento
          </TabsTrigger>
          <TabsTrigger value="monitor" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Monitor DOC-e
          </TabsTrigger>
          <TabsTrigger value="consulta" className="gap-2">
            <FileSearch className="h-4 w-4" /> Consulta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faturamento" className="mt-0">
          <Billing />
        </TabsContent>
        <TabsContent value="monitor" className="mt-0">
          <CteMonitor />
        </TabsContent>
        <TabsContent value="consulta" className="mt-0">
          <CteSearch />
        </TabsContent>
      </Tabs>
    </div>
  );
}
