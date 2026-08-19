import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileSpreadsheet, ShieldCheck, FileSearch } from 'lucide-react';
import Billing from '@/pages/Billing';
import CteMonitor from '@/pages/CteMonitor';
import CteSearch from '@/pages/CteSearch';

export default function CteHub() {
  const initialTab = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('tab') || 'faturamento')
    : 'faturamento';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchParams] = useSearchParams();

  // Mantém a aba sincronizada quando outras telas navegam para ?tab=monitor|consulta.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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
