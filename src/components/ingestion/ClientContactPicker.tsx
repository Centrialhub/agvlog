import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, MapPin, Phone, Save, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useClients, useUpdateClient, useCreateClient, Client } from '@/hooks/useClients';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface ContactSnapshot {
  phone?: string;
  name?: string;
  email?: string;
}

export interface AddressSnapshot {
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ClientContactPickerProps {
  /** Read from the ORT being reviewed */
  hintName?: string;
  hintCnpj?: string;
  /** Currently linked client (if any) */
  selectedClientId?: string | null;
  /** Current values being edited (so we can save them back to the client) */
  currentContact: ContactSnapshot;
  currentAddress: AddressSnapshot;
  /** Apply selected client to the doc + optionally pre-fill an address/contact */
  onSelectClient: (clientId: string, client: Client) => void;
  onApplyContact: (contact: ContactSnapshot) => void;
  onApplyAddress: (address: AddressSnapshot) => void;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');

const addressLabel = (a: AddressSnapshot) =>
  [a.street, a.number, a.neighborhood, a.city && `${a.city}/${a.state || ''}`, a.zip].filter(Boolean).join(', ');

const contactLabel = (c: ContactSnapshot) =>
  [c.name, c.phone, c.email].filter(Boolean).join(' · ');

export default function ClientContactPicker({
  hintName, hintCnpj, selectedClientId,
  currentContact, currentAddress,
  onSelectClient, onApplyContact, onApplyAddress,
}: ClientContactPickerProps) {
  const { data: clients = [] } = useClients();
  const updateClient = useUpdateClient();
  const createClient = useCreateClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  // Auto-suggest by CNPJ then name
  const suggested = useMemo(() => {
    const cnpj = onlyDigits(hintCnpj || '');
    if (cnpj) {
      const m = clients.find(c => onlyDigits(c.tax_id || '') === cnpj);
      if (m) return m;
    }
    if (hintName) {
      const lower = hintName.toLowerCase();
      return clients.find(c => c.company_name.toLowerCase() === lower)
        || clients.find(c => c.company_name.toLowerCase().includes(lower) || lower.includes(c.company_name.toLowerCase()));
    }
    return undefined;
  }, [clients, hintCnpj, hintName]);

  const selectedClient = clients.find(c => c.id === selectedClientId) || suggested;
  const contacts: ContactSnapshot[] = Array.isArray(selectedClient?.contacts) ? (selectedClient!.contacts as any[]) : [];
  const addresses: AddressSnapshot[] = Array.isArray(selectedClient?.addresses) ? (selectedClient!.addresses as any[]) : [];

  const filtered = useMemo(() => clients.slice(0, 200), [clients]);

  const handleSelect = (id: string) => {
    const c = clients.find(x => x.id === id);
    if (c) onSelectClient(id, c);
    setOpen(false);
  };

  const isContactDuplicate = (target: ContactSnapshot) => {
    const ph = onlyDigits(target.phone || '');
    if (!ph) return false;
    return contacts.some(c => onlyDigits(c.phone || '') === ph);
  };
  const isAddressDuplicate = (target: AddressSnapshot) => {
    const zip = onlyDigits(target.zip || '');
    const street = (target.street || '').trim().toLowerCase();
    const num = (target.number || '').trim().toLowerCase();
    if (!street && !zip) return false;
    return addresses.some(a =>
      (zip && onlyDigits(a.zip || '') === zip && (a.number || '').toLowerCase() === num)
      || ((a.street || '').trim().toLowerCase() === street && (a.number || '').toLowerCase() === num && street.length > 0)
    );
  };

  const persistToClient = async (patch: Partial<Client>) => {
    if (!selectedClient) return;
    await updateClient.mutateAsync({ id: selectedClient.id, ...patch });
  };

  const handleSaveContact = async () => {
    if (!selectedClient) {
      toast({ title: 'Selecione um cliente antes de salvar o contato', variant: 'destructive' });
      return;
    }
    if (!currentContact.phone) {
      toast({ title: 'Telefone vazio — nada para salvar', variant: 'destructive' });
      return;
    }
    if (isContactDuplicate(currentContact)) {
      toast({ title: 'Contato já cadastrado nesse cliente' });
      return;
    }
    const next = [...contacts, currentContact];
    await persistToClient({ contacts: next as any });
    toast({ title: 'Contato salvo no cliente', description: contactLabel(currentContact) });
  };

  const handleSaveAddress = async () => {
    if (!selectedClient) {
      toast({ title: 'Selecione um cliente antes de salvar o endereço', variant: 'destructive' });
      return;
    }
    if (!currentAddress.street && !currentAddress.zip) {
      toast({ title: 'Endereço vazio — nada para salvar', variant: 'destructive' });
      return;
    }
    if (isAddressDuplicate(currentAddress)) {
      toast({ title: 'Endereço já cadastrado nesse cliente' });
      return;
    }
    const next = [...addresses, currentAddress];
    await persistToClient({ addresses: next as any });
    toast({ title: 'Endereço salvo no cliente', description: addressLabel(currentAddress) });
  };

  const handleCreateClient = async () => {
    if (!hintName) return;
    try {
      const created: any = await createClient.mutateAsync({
        company_name: hintName,
        tax_id: hintCnpj || null,
        contacts: currentContact.phone ? [currentContact] : [],
        addresses: (currentAddress.street || currentAddress.zip) ? [currentAddress] : [],
      } as any);
      if (created?.id) onSelectClient(created.id, created);
      toast({ title: 'Cliente cadastrado a partir da ORT' });
    } catch (e: any) {
      toast({ title: 'Erro ao cadastrar cliente', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="h-8 justify-between text-xs" size="sm">
                {selectedClient ? selectedClient.company_name : (suggested ? `Sugestão: ${suggested.company_name}` : 'Vincular cliente')}
                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Buscar cliente por nome ou CNPJ..." />
                <CommandList>
                  <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                  <CommandGroup>
                    {filtered.map(c => (
                      <CommandItem key={c.id} value={`${c.company_name} ${c.tax_id || ''}`} onSelect={() => handleSelect(c.id)}>
                        <Check className={cn('mr-2 h-4 w-4', selectedClient?.id === c.id ? 'opacity-100' : 'opacity-0')} />
                        <span className="flex-1 truncate">{c.company_name}</span>
                        {c.tax_id && <span className="ml-2 text-[11px] text-muted-foreground">{c.tax_id}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {!selectedClient && hintName && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleCreateClient}>
              <UserPlus className="mr-1 h-3.5 w-3.5" /> Cadastrar "{hintName}"
            </Button>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleSaveContact} disabled={!selectedClient || !currentContact.phone}>
              <Save className="mr-1 h-3.5 w-3.5" /> Salvar contato
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleSaveAddress} disabled={!selectedClient || (!currentAddress.street && !currentAddress.zip)}>
              <Save className="mr-1 h-3.5 w-3.5" /> Salvar endereço
            </Button>
          </div>
        </div>

        {selectedClient && (contacts.length > 0 || addresses.length > 0) && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {contacts.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Contatos cadastrados</p>
                <div className="flex flex-wrap gap-1.5">
                  {contacts.map((c, i) => (
                    <Badge key={i} variant="outline" className="cursor-pointer gap-1 hover:bg-primary/10" onClick={() => onApplyContact(c)}>
                      <Phone className="h-3 w-3" /> {contactLabel(c) || '—'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {addresses.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Endereços cadastrados</p>
                <div className="flex flex-wrap gap-1.5">
                  {addresses.map((a, i) => (
                    <Badge key={i} variant="outline" className="cursor-pointer gap-1 hover:bg-primary/10" onClick={() => onApplyAddress(a)}>
                      <MapPin className="h-3 w-3" /> {addressLabel(a) || '—'}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}