# Correção de Navegação de Recursos Indisponíveis

## Objetivo
Ajustar `src/components/layout/AppLayout.tsx` para que links de funcionalidades ainda não liberadas ou inexistentes não apareçam na navegação lateral, sem alterar rotas, flags ou páginas.

## Alterações

### 1. Gating por feature flag
- Adicionar `feature: 'LOAD_CONTROL'` ao item **Controle de Cargas** (`/load-control`).
- Adicionar `feature: 'HR_CORE'` ao item **Funcionários** (`/employees`).

### 2. Remoção de link sem rota/componente
- Remover o item **MDF (provisório)** (`/mdfe-provisional`) do grupo **Documentos Fiscais**. Ele não possui rota nem componente e está incorretamente associado a `DRIVER_WORKSPACE`.

### 3. Grupos vazios
- Garantir que grupos de navegação (`NavGroup`) cujos itens filtrados estejam vazios não sejam renderizados, evitando cabeçalhos de grupo sem conteúdo.

## Critérios de aceitação
- Nenhum link visível na sidebar leva para rota inexistente (`/mdfe-provisional`).
- Itens de **Controle de Cargas** e **Funcionários** só aparecem quando suas respectivas feature flags estiverem ativas.
- Grupos sem itens visíveis não são renderizados.
- Rotas, flags (`src/lib/featureFlags.ts`) e páginas não são modificadas.
