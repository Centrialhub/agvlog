---
title: Implementar exclusão de acerto de motorista
description: Adicionar funcionalidade de exclusão de acertos de motorista com dupla confirmação e auditoria.
---

## Etapa 1: Banco de Dados (Supabase)

Criar uma RPC para exclusão segura de acertos de motorista, garantindo que registros relacionados sejam limpos ou desvinculados corretamente.

- **RPC `delete_driver_settlement`**:
  - Recebe `_settlement_id` e `_reason`.
  - Valida se o acerto existe e pertence ao tenant.
  - Verifica se o status permite exclusão (ex: não permitir se já estiver 'paid' ou 'closed', a menos que explicitamente permitido).
  - Desvincula romaneios (`loads`) definindo `driver_settlement_id = NULL`.
  - Remove itens, eventos e pagamentos associados.
  - Registra um log de auditoria na tabela de eventos global ou específica.
  - Remove o registro principal de `driver_settlements`.

## Etapa 2: Frontend (Hooks)

Atualizar o hook de acertos para incluir a funcionalidade de exclusão.

- **`src/hooks/useDriverSettlements.tsx`**:
  - Adicionar o hook `useDeleteDriverSettlement`.
  - Implementar a mutação chamando a RPC `delete_driver_settlement`.
  - Invalidar as queries `driver_settlements` e `available_loads_for_settlement` após o sucesso.

## Etapa 3: Frontend (Componentes)

Adicionar a interface de exclusão com dupla confirmação.

- **`src/components/financial/DriverSettlementDrawer.tsx`**:
  - Adicionar um botão de "Excluir Acerto" (ícone de lixeira ou texto em vermelho).
  - Implementar um `AlertDialog` (ou similar do shadcn/ui) para a primeira confirmação.
  - Solicitar um motivo para a exclusão na segunda etapa da confirmação (campo de texto).
  - Chamar o hook de exclusão e fechar o drawer após a conclusão.
