import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DollarSign, Map, Calculator } from 'lucide-react';
import FreightTables from './FreightTables';
import ClientRegions from './ClientRegions';
import FreightSimulator from './FreightSimulator';
import { useSearchParams } from 'react-router-dom';

export default function FreightHub() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const initial = tabParam === 'regions' ? 'regions' : tabParam === 'simulator' ? 'simulator' : 'tables';
  const [tab, setTab] = useState(initial);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Frete Automático</h1>
        <p className="text-sm text-muted-foreground">
          Configuração de tabelas de frete e regiões usadas no cálculo automático do CT-e.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          const next = new URLSearchParams(params);
          if (v === 'tables') next.delete('tab');
          else next.set('tab', v);
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="tables" className="gap-2">
            <DollarSign className="h-4 w-4" /> Tabelas de Frete
          </TabsTrigger>
          <TabsTrigger value="regions" className="gap-2">
            <Map className="h-4 w-4" /> Regiões
          </TabsTrigger>
          <TabsTrigger value="simulator" className="gap-2">
            <Calculator className="h-4 w-4" /> Prévia / Simulador
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="mt-4">
          <FreightTables />
        </TabsContent>
        <TabsContent value="regions" className="mt-4">
          <ClientRegions />
        </TabsContent>
        <TabsContent value="simulator" className="mt-4">
          <FreightSimulator />
        </TabsContent>
      </Tabs>
    </div>
  );
}