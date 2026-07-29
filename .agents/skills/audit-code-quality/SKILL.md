---
name: "Audit: Code Quality"
description: Analisa a qualidade estrutural do código identificando problemas que travam ferramentas de IA: arquivos acima de 300 linhas, God Components com responsabilidades demais, lógica duplicada que deveria ser hook ou utilitário, nomes inconsistentes, valores hardcoded, dead code e imports não utilizados. Refatora automaticamente os casos mais críticos e lista os demais com prioridade de resolução.
---

Audit this project for code quality issues that will slow me down or break my AI tool's ability to help. Check the following in order of severity.

1. FILE SIZE — List every file over 300 lines. What is it doing? Could it be split into smaller, focused files? Files over 500 lines exceed most AI tool context windows.

2. GOD COMPONENTS — Find components that handle UI rendering AND data fetching AND business logic in the same file. Could the data fetching be separated from the display?

3. DUPLICATED LOGIC — Search for logic that appears in multiple places: similar API calls in different components, repeated validation rules, copy-pasted utility functions.

4. NAMING AND STRUCTURE — Are file and folder names consistent (camelCase vs kebab-case vs PascalCase)? Is there a clear structure (pages/components/hooks/utils/types)? Can you tell what a file does from its name?

5. SEPARATION OF CONCERNS — Does the codebase separate: UI components, data access (API calls, DB queries), and business logic (rules, validation, transformations)?

6. DEAD CODE — Search for: commented-out code blocks, unused imports, functions or components defined but never called, unreachable branches.

7. FUNCTION COMPLEXITY — Find functions with more than 5 branches (if/else, switch, ternaries), deeply nested logic (4+ levels), or dense one-liner expressions packing multiple conditions.

8. HARDCODED VALUES — Search for magic numbers, hardcoded URLs, repeated string literals, and config values scattered through code instead of defined as constants or env vars.

For each finding: Number, Severity, file and line, what's wrong, what could happen, how to fix.
IMPORTANT: Audit only — do NOT modify code.