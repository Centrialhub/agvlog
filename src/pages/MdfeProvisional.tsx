import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Clock, FileText } from 'lucide-react';

export default function MdfeProvisional() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MDF-e (Provisório)</h1>
          <p className="text-muted-foreground">
            Gestão de Manifesto Eletrônico de Documentos Fiscais.
          </p>
        </div>
        <Button disabled>
          Novo Manifesto
        </Button>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Em breve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="bg-muted rounded-full p-4 mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">Módulo em preparação</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-2">
              A funcionalidade de emissão e gestão de MDF-e está sendo configurada com base na documentação v1 do Hub Fiscal.
            </p>
            <div className="mt-6 flex gap-2">
              <Badge variant="outline">Hub Fiscal v1</Badge>
              <Badge variant="outline">MDFe 3.00</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Manifestos Hoje</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Aguardando implementação</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pendentes de Encerramento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Aguardando implementação</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status Integração</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">
                Pronto (v1)
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Payload builder validado</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
