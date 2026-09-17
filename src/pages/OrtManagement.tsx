import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileSearch, Sparkles } from 'lucide-react';
import OrtConsultaTab from '@/components/fiscal/OrtConsultaTab';
import OrtGeracaoTab from '@/components/fiscal/OrtGeracaoTab';

export default function OrtManagement() {
  const [params, setParams] = useSearchParams();
  const normalizeTab = (value: string | null) => value === 'geracao' ? 'geracao' : 'consulta';
  const [activeTab, setActiveTab] = useState(() => normalizeTab(params.get('tab')));
  useEffect(() => {
    const raw = params.get('tab');
    const nextTab = normalizeTab(raw);
    setActiveTab(current => current === nextTab ? current : nextTab);
    if (raw && raw !== nextTab) {
      const next = new URLSearchParams(params); next.delete('tab'); setParams(next, { replace: true });
    }
  }, [params, setParams]);
  const changeTab = (value: string) => {
    const nextTab = normalizeTab(value); setActiveTab(nextTab);
    const next = new URLSearchParams(params);
    if (nextTab === 'consulta') next.delete('tab'); else next.set('tab', nextTab);
    setParams(next);
  };

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSearch className="h-6 w-6 text-primary" /> ORT — Ordens de Recolhimento / Transferência
        </h1>
        <p className="text-sm text-muted-foreground">
          Consulte histórico de ORTs e gere novas a partir de notas fiscais de entrada.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="consulta" className="gap-2">
            <FileSearch className="h-4 w-4" /> Consulta
          </TabsTrigger>
          <TabsTrigger value="geracao" className="gap-2">
            <Sparkles className="h-4 w-4" /> Geração
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consulta" className="mt-0">
          <OrtConsultaTab />
        </TabsContent>

        <TabsContent value="geracao" className="mt-0">
          <OrtGeracaoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
