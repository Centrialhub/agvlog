# Plano de Implementação: MDF-e Provisório (Etapa 1: Seleção e Homologação)

Este plano descreve a evolução da página `/mdfe-provisional` para permitir a seleção de CT-es autorizados, preenchimento de dados do manifesto e transmissão manual para o Hub Fiscal, visando a validação do motor de emissão.

## Objetivos
- Listar CT-es com status `authorized` (autorizado) na página provisória.
- Permitir a seleção múltipla de CT-es para compor um único MDF-e.
- Implementar um formulário para preenchimento de dados complementares (veículo, condutor, origem/destino).
- Integrar com o Hub Fiscal para transmissão do MDF-e.
- Fornecer opções de sincronização e cancelamento para testes.

## Detalhes Técnicos

### 1. Backend / Dados
- **Hook `useAuthorizedCteList`**: Já criado, busca documentos da tabela `fiscal_documents` com `status = 'authorized'` e `document_type = 'outbound'`.
- **Integração Hub**: Utilizar a Edge Function `hub-fiscal-proxy` enviando o payload gerado pelo `mdfeBuilder.ts`.

### 2. Interface (UI)
- **Página `MdfeProvisional.tsx`**:
  - Tabela de CT-es com checkbox para seleção.
  - Botão "Próximo" para abrir o formulário de dados do MDF-e.
  - Diálogo/Modal para preenchimento de:
    - Veículo (Placa, UF, RNTRC).
    - Motorista (Nome, CPF).
    - Localidades (Origem e Destino com código IBGE).
  - Botão de Transmissão final.

### 3. Workflow de Homologação
- O usuário seleciona os CT-es -> Clica em Gerar -> Preenche os dados -> Transmite.
- O sistema exibe o status de retorno do SEFAZ via Hub.
- Botão de Sincronizar para atualizar o status dos manifestos emitidos.

## Próximos Passos
1. [x] Criar hook `useAuthorizedCteList`.
2. [x] Atualizar `MdfeProvisional.tsx` com a listagem e seleção de CT-es.
3. [ ] Criar componente `MdfeEmissionForm` para capturar dados do veículo/motorista.
4. [ ] Implementar chamada ao `hub-fiscal-proxy` para o tipo `mdfe`.
