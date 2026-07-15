
## Objetivo

Permitir criar um **acerto de motorista manual** (fora do fluxo automático baseado em viagem), vinculando **um ou mais romaneios (loads)** ao acerto, com a garantia de que cada romaneio só pode estar em **um único acerto ao mesmo tempo**. Manter possibilidade de correção (adicionar/remover romaneios) enquanto o acerto não estiver aprovado/pago/fechado.

## O que muda para o usuário

Na página **Acerto de Motoristas**:

1. Novo botão **"Novo acerto manual"** ao lado de "Gerar / Recalcular pendentes".
2. Diálogo de criação: escolher **motorista**, **veículo** (opcional), **data**, e selecionar **romaneios elegíveis** (finalizados/entregues e ainda não vinculados a nenhum outro acerto). Busca por nº do romaneio, origem, destino.
3. Ao confirmar, o acerto é criado e recalcula automaticamente totais (peso, notas, frete, mercadoria, despesas, KM, resultado da rota) a partir dos romaneios selecionados.
4. No drawer do acerto (aba **Romaneios**), enquanto o acerto **não estiver** aprovado/pago/fechado:
   - Botão **"Adicionar romaneio"** — abre picker mostrando apenas romaneios ainda livres.
   - Botão **"Remover"** por linha — desvincula o romaneio, liberando-o para outro acerto.
   - Cada alteração dispara **recálculo** dos totais.
5. Regra de exclusividade: se um romaneio já está em outro acerto ativo (não `reopened` sem vínculo), ele **não aparece** na lista de disponíveis. Tentativa direta retorna erro claro ("Romaneio já vinculado ao acerto #X").

## Como funciona por dentro (técnico)

### Banco de dados (migração)

- Nova tabela **`driver_settlement_loads`** (link N:N entre acerto e load) com:
  - `settlement_id uuid NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE`
  - `load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE`
  - `tenant_id uuid NOT NULL`, `created_at`, `created_by`
  - **`UNIQUE(load_id)` parcial** (exclusividade global do romaneio em qualquer acerto ativo). Como remoção é hard-delete da linha, o unique simples resolve.
  - RLS + GRANTs padrão do projeto.
- Tornar `dispatch_trip_id` **nullable** em `driver_settlements` (necessário para acertos manuais). Ajustar constraint única existente (`UNIQUE(dispatch_trip_id)`) para permitir múltiplos nulls (Postgres já permite) ou converter em unique parcial `WHERE dispatch_trip_id IS NOT NULL`.
- Novo campo `is_manual boolean NOT NULL DEFAULT false` para diferenciar origem.

### Funções RPC (novas)

- `create_manual_driver_settlement(_tenant_id, _driver_id, _vehicle_id, _reference_date, _load_ids uuid[])`
  - Valida motorista/tenant, checa que nenhum `load_id` está em outro acerto (via `driver_settlement_loads` ou via `dispatch_trip_id` do trip que já gerou acerto), cria settlement `pending_review`, insere links e chama recálculo.
- `attach_loads_to_driver_settlement(_settlement_id, _load_ids uuid[])` — só em status editável; valida exclusividade; recalcula.
- `detach_load_from_driver_settlement(_settlement_id, _load_id)` — só em status editável; recalcula.
- `recalculate_manual_driver_settlement(_settlement_id)` — agrega totais a partir dos loads vinculados + despesas do motorista no período (mesma lógica dos automáticos, mas fonte = links, não trip).
- `list_available_loads_for_settlement(_tenant_id, _driver_id, _search, _limit)` — retorna romaneios finalizados e ainda não vinculados a nenhum acerto ativo.

### Front-end

- `src/hooks/useDriverSettlements.tsx`: novos hooks `useCreateManualSettlement`, `useAttachLoadsToSettlement`, `useDetachLoadFromSettlement`, `useAvailableLoadsForSettlement`.
- `src/components/financial/NewManualSettlementDialog.tsx` (novo): motorista + veículo + data + tabela multi-select de romaneios disponíveis.
- `src/components/financial/AttachLoadsDialog.tsx` (novo): reutilizado dentro do drawer para adicionar romaneios a um acerto existente.
- `src/pages/DriverSettlements.tsx`: botão "Novo acerto manual".
- `src/components/financial/DriverSettlementDrawer.tsx`: na aba Romaneios, adicionar botões Adicionar/Remover quando `!isLocked(status)`.

## Fora do escopo

- Redesenho da lógica de cálculo automática já existente para viagens.
- Regras novas de contabilidade/aprovação — reaproveitamos o pipeline atual de status.
