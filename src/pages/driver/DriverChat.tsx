import { useEffect, useRef, useState } from 'react';
import { useCurrentDriver } from '@/hooks/useCurrentDriver';
import { useDriverMessages, useSendDriverMessage } from '@/hooks/useDriverMessages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function DriverChat() {
  const { data: driver, isLoading: loadingDriver } = useCurrentDriver();
  const { data: messages = [], isLoading } = useDriverMessages(driver?.id);
  const send = useSendDriverMessage();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const v = text.trim();
    if (!v || !driver) return;
    try {
      await send.mutateAsync({ driverId: driver.id, message: v, role: 'driver', name: driver.name });
      setText('');
    } catch {
      // keep text so the user can retry
    }
  };

  if (loadingDriver) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Sua conta não está vinculada a um motorista.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b bg-card flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <div>
          <div className="text-sm font-semibold">Chat com a operação</div>
          <div className="text-[11px] text-muted-foreground">Mensagens em tempo real</div>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
        {isLoading ? (
          <div className="text-center text-xs text-muted-foreground py-4">Carregando mensagens...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">Nenhuma mensagem ainda. Aguarde ou inicie a conversa.</div>
        ) : (
          messages.map(m => {
            const fromDriver = m.sender_role === 'driver';
            return (
              <div key={m.id} className={`flex ${fromDriver ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${fromDriver ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>
                  <div className={`text-[10px] mb-0.5 opacity-70 ${fromDriver ? '' : 'text-muted-foreground'}`}>
                    {fromDriver ? 'Você' : `🏢 ${m.sender_name || 'Operação'}`}
                    {' · '}
                    {format(new Date(m.created_at), 'dd/MM HH:mm')}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.message}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="p-3 border-t bg-background flex gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <Input
          placeholder="Escreva uma mensagem..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <Button onClick={handleSend} disabled={send.isPending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}