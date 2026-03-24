import { ValidatedDocument, ValidatedOrder } from '@/lib/ingestionValidator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  FileText, CheckCircle, AlertTriangle, XCircle, ArrowRight, ArrowLeft, Package, Info,
} from 'lucide-react';

interface ValidationStepProps {
  docs: ValidatedDocument[];
  orders: ValidatedOrder[];
  onBack: () => void;
  onNext: () => void;
}

export default function ValidationStep({ docs, orders, onBack, onNext }: ValidationStepProps) {
  const totalErrors = docs.filter(d => d.hasErrors).length + orders.filter(o => o.hasErrors).length;
  const totalWarnings = docs.filter(d => d.hasWarnings && !d.hasErrors).length + orders.filter(o => o.hasWarnings && !o.hasErrors).length;
  const totalValid = docs.filter(d => !d.hasErrors).length + orders.filter(o => !o.hasErrors).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-success" />
            <div>
              <div className="text-2xl font-bold text-success">{totalValid}</div>
              <div className="text-xs text-muted-foreground">Válidos</div>
            </div>
          </CardContent>
        </Card>
        <Card className={totalWarnings > 0 ? 'border-warning/50' : ''}>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <div>
              <div className="text-2xl font-bold text-warning">{totalWarnings}</div>
              <div className="text-xs text-muted-foreground">Avisos</div>
            </div>
          </CardContent>
        </Card>
        <Card className={totalErrors > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-destructive" />
            <div>
              <div className="text-2xl font-bold text-destructive">{totalErrors}</div>
              <div className="text-xs text-muted-foreground">Erros (bloqueados)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {docs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" /> Notas Fiscais ({docs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>NF</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Paletes</TableHead>
                  <TableHead>Peso</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc, i) => (
                  <TableRow key={i} className={doc.hasErrors ? 'bg-destructive/5' : doc.hasWarnings ? 'bg-warning/5' : ''}>
                    <TableCell className="text-xs font-mono">{doc.fileName}</TableCell>
                    <TableCell className="font-medium">{doc.source.invoiceNumber || '—'}</TableCell>
                    <TableCell className="text-sm">
                      {doc.matchedClientName ? (
                        <span className="text-success">{doc.matchedClientName}</span>
                      ) : (
                        <span className="text-muted-foreground">{doc.source.recipientName || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[doc.source.recipientCity, doc.source.recipientState].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell>{doc.source.estimatedPallets || '—'}</TableCell>
                    <TableCell>{doc.source.totalWeight ? `${doc.source.totalWeight} kg` : '—'}</TableCell>
                    <TableCell>{doc.source.totalValue ? `R$ ${doc.source.totalValue.toLocaleString('pt-BR')}` : '—'}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {doc.hasErrors ? (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive text-xs">Erro</Badge>
                        ) : doc.hasWarnings ? (
                          <Badge variant="outline" className="bg-warning/10 text-warning text-xs">Aviso</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-success/10 text-success text-xs">OK</Badge>
                        )}
                        {doc.validations.map((v, vi) => (
                          <div key={vi} className={`text-[10px] flex items-center gap-1 ${
                            v.severity === 'error' ? 'text-destructive' :
                            v.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                          }`}>
                            {v.severity === 'error' ? <XCircle className="h-2.5 w-2.5" /> :
                             v.severity === 'warning' ? <AlertTriangle className="h-2.5 w-2.5" /> :
                             <Info className="h-2.5 w-2.5" />}
                            {v.message}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {orders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" /> Pedidos ({orders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Paletes</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, i) => (
                  <TableRow key={i} className={order.hasErrors ? 'bg-destructive/5' : order.hasWarnings ? 'bg-warning/5' : ''}>
                    <TableCell className="font-medium">{order.source.orderNumber}</TableCell>
                    <TableCell className="text-sm">
                      {order.matchedClientName ? (
                        <span className="text-success">{order.matchedClientName}</span>
                      ) : (
                        <span className="text-muted-foreground">{order.source.clientName || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{order.source.destination || '—'}</TableCell>
                    <TableCell>{order.source.quantity || '—'}</TableCell>
                    <TableCell>{order.source.palletCount || '—'}</TableCell>
                    <TableCell>
                      {order.hasErrors ? (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive text-xs">Erro</Badge>
                      ) : order.hasWarnings ? (
                        <Badge variant="outline" className="bg-warning/10 text-warning text-xs">Aviso</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-success/10 text-success text-xs">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        <Button onClick={onNext} disabled={totalValid === 0}>
          Gerar Sugestões de Carga <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
