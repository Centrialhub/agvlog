import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DollarSign, Map } from 'lucide-react';
import FreightTables from './FreightTables';
import ClientRegions from './ClientRegions';
import { useSearchParams } from 'react-router-dom';

export default function FreightHub() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('tab') === 'regions' ? 'regions' : 'tables';
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
          if (v === 'regions') next.set('tab', 'regions');
          else next.delete('tab');
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
        </TabsList>
        <TabsContent value="tables" className="mt-4">
          <FreightTables />
        </TabsContent>
        <TabsContent value="regions" className="mt-4">
          <ClientRegions />
        </TabsContent>
      </Tabs>
    </div>
  );
}