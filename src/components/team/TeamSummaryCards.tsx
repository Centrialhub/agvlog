import type React from 'react';
import { Building2, ShieldCheck, Truck, UserCog } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export const roleLabels: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  operator: 'Operador',
  client: 'Cliente',
  driver: 'Motorista',
};

export const roleIcons: Record<string, React.ReactNode> = {
  owner: <ShieldCheck className="h-3.5 w-3.5" />,
  admin: <ShieldCheck className="h-3.5 w-3.5" />,
  operator: <UserCog className="h-3.5 w-3.5" />,
  client: <Building2 className="h-3.5 w-3.5" />,
  driver: <Truck className="h-3.5 w-3.5" />,
};

export function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleInfo({ role, desc }: { role: string; desc: string }) {
  return (
    <div className="flex gap-2 rounded-md border p-3">
      <div className="mt-0.5">{roleIcons[role]}</div>
      <div>
        <p className="font-medium text-foreground text-sm">{roleLabels[role]}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
