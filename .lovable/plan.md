

# Diagnóstico: Por que quase todos aparecem offline

## Causa Raiz

O filtro cross-unit **está funcionando corretamente**. O problema real é diferente:

**Todos os 15 units têm um `poll_memo` válido** (combo descoberto e funcionando). Mas quando o veículo está **parado** e a SSX retorna **0 posições** na janela incremental (porque não há novos pontos GPS), o código trata isso como falha:

```text
Memo combo → SSX retorna 200 OK, 0 items (veículo parado)
  → Code: items.length === 0 → fall through
  → Scout hint → empty → fall through  
  → Discovery (8 tentativas) → all empty
  → Result: "No combination returned positions" ← ERRO!
  → workingCombo = null → cursor NÃO avança
  → positions_last.received_at NÃO atualiza
  → Frontend: "Posição antiga" / "Offline"
```

Só GVJ3562 e PXT0255 aparecem online porque **estavam em movimento** no momento do poll, gerando novos pontos GPS.

## O que precisa ser corrigido

### 1. Confiar no memo quando SSX retorna vazio (veículo parado é normal)

No `pollSingleUnit`, quando o memo combo retorna 200 OK com 0 items, **não cair no discovery**. Retornar resultado de "no new data" preservando o `workingCombo` do memo.

### 2. Heartbeat em `positions_last.received_at`

No loop principal, quando o poll retorna com `workingCombo` válido mas sem novos pontos (`latestNormalized == null`), **atualizar apenas o `received_at`** do `positions_last` existente. Isso funciona como heartbeat — o frontend vê que o polling está ativo e mantém o veículo como "parado" ao invés de "offline".

### 3. Não setar `last_error` quando é apenas "sem dados novos"

O cursor deve distinguir entre "SSX retornou vazio porque não há novos dados" (normal) e "nenhuma combinação funcionou" (erro real).

## Mudanças

| Arquivo | Alteração |
|---------|-----------|
| `supabase/functions/ssx-poll-positions/index.ts` | Stage 1 memo: retornar "no_new_data" ao invés de fall-through quando items=0. Loop principal: heartbeat received_at quando workingCombo existe mas latestNormalized é null. |

## Impacto Esperado

- Veículos parados passam a mostrar "Parado" (âmbar) ao invés de "Posição antiga" (cinza)
- Economia de requests SSX: sem discovery desnecessário para veículos com memo válido
- `last_error` fica null para todos os units com memo funcionando

