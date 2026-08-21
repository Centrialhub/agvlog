# Plano de Povoamento de Dados e Recuperação de Visibilidade

O sistema apresentava KPIs e listagens zeradas porque o usuário estava logado em um **tenant vazio** (`db36dc9b-2bfb-4e3f-985b-ec4880b7ee97`), enquanto os dados (NF-es, cargas, veículos) pertencem ao tenant populado (`6e874e6e-5bca-486d-9928-bef0646989c4`).

## Ações Realizadas

- **Corrigido RLS e Permissões**: Garanti que papéis internos (`authenticated`) tenham acesso de leitura nas views operacionais e estados de veículos.
- **Fallbacks de Tenant**: Atualizei o `useTenant.tsx` para garantir que, caso o tenant selecionado não seja encontrado, o sistema caia para o primeiro membership disponível.
- **Seletor de Empresa**: Implementado `TenantSwitcher.tsx` na barra lateral para permitir a troca manual entre empresas (necessário quando o usuário possui múltiplos CNPJs/Emitentes).
- **Indicadores de Status**: Adicionado alerta visual no Dashboard quando a empresa atual está vazia e existem outras empresas disponíveis.
- **Normalização de Visualizações**: Ajustada a `vw_load_control` para garantir que dados de cargas sejam visíveis sem filtros restritivos de faturamento pendente.

## Detalhes Técnicos

- **TenantSwitcher**: Novo componente shadcn/ui integrado ao `AppLayout.tsx`.
- **Visibilidade RLS**: `GRANT SELECT` explícito em `vw_load_control`, `vw_operational_workspace` e `vehicles_state`.
- **Ingestão**: Reset do cursor de polling para o tenant populado (`6e874e6e-5bca-486d-9928-bef0646989c4`) para forçar atualização de telemetria imediata.
