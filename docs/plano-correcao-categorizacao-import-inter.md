# Plano de correção: categorização incorreta na importação (fatura Inter)

Continuação de [`investigacao-categorizacao-import-inter.md`](./investigacao-categorizacao-import-inter.md). Este documento separa a correção em etapas independentes, cada uma entregável e testável isoladamente, na ordem recomendada de implementação.

---

## Etapa 1 — Confiar na categoria do CSV quando ela for reconhecida ✅ Implementado

**Objetivo:** parar de depender da IA quando o próprio banco já manda a categoria. Antes, `parseCsvRow` só aceitava a categoria do CSV se o texto batesse exatamente com o enum interno em inglês (`FOOD`, `HOUSING`...), o que nunca acontecia com CSVs reais em português.

**O que foi implementado (difere um pouco do desenho original abaixo — ver nota):**
- Novo arquivo `src/utils/csv-category-dictionary.ts`: dicionário normalizado (sem acento, case-insensitive) de sinônimos em português → `TransactionCategory` + nome de categoria do usuário (ex.: "Supermercado" → `FOOD` / "Alimentação"; "Transporte" → `TRANSPORTATION` / "Transporte"; "Lazer" → `ENTERTAINMENT` / "Entretenimento" etc.), com nomes alinhados ao `scripts/seed-categories.ts` para casar com categorias já existentes do usuário.
  - ⚠️ **Ainda é uma lista provisória**, construída com categorias conhecidas do Inter/mercado financeiro brasileiro, não com um export real. Segue precisando de validação/ajuste contra uma amostra real do CSV do Inter — assim que você me passar os valores reais (ou um export), ajusto o dicionário.
- `parseCsvRow` (`src/utils/parse-csv-row.ts`) agora tenta esse mapeamento sobre `rawCategoryText` quando o match direto no enum falha, preenchendo `category` + o novo campo `categoryName` no DTO `ParsedTransaction`.
- `ImportService.import` (`src/service/import-service.ts`): **nota sobre a diferença em relação ao plano original** — em vez de pular a chamada à IA por transação, a chamada em lote (`detectTransactionsBatchWithIA`) continua acontecendo para todas as transações (ainda é ela quem decide `type`/`paymentMethod`, que o CSV do Inter não traz). O que muda é que, ao montar a mensagem final, a **categoria resolvida pelo CSV sempre prevalece sobre o palpite da IA** — inclusive quando a chamada à IA falha inteira e cai no fallback do lote (causa raiz nº2 da investigação). Isso resolve o sintoma relatado ("tudo vai pra Outros") sem precisar esperar pela Etapa 2, porque a categoria deixou de depender do sucesso da IA para os textos reconhecidos.
- `categoryId` para essas transações é resolvido (ou criado, se o usuário ainda não tiver essa categoria) via `CategoryRepository`, buscando as categorias do usuário uma única vez por importação (`buildCsvCategoryIdCache`) — evita N chamadas ao banco e evita criar categoria duplicada.

**Arquivos afetados:** `csv-category-dictionary.ts` (novo), `csv-category-dictionary.test.ts` (novo), `parse-csv-row.ts`, `parse-csv-row.test.ts`, `parsed-transaction.dto.ts` (+`categoryName`), `import-service.ts`, `import-service-csv-category.test.ts` (novo).

**Critério de aceite:** ✅ validado por teste — uma transação com `Categoria: "Supermercado"` é publicada na fila com `category = FOOD` e `categoryId` resolvido, **mesmo quando o mock da IA retorna o fallback `OTHER`** (ver `import-service-csv-category.test.ts`, teste "keeps the category resolved from the CSV even when the AI batch call falls back to OTHER"). Suíte completa: 102/102 testes passando, `tsc --noEmit` limpo.

---

## Etapa 2 — Isolar falhas de classificação em lote (parar de jogar tudo em "Outros") ✅ Implementado

**Objetivo:** garantir que uma falha pontual (timeout, resposta malformada, erro de rede) não derrube as demais transações do mesmo lote de até 50 itens para `OTHER`.

**O que foi implementado:**
- `classifyBatch` (`src/core/gemini/detect-transactions-batch-with-ia.ts`) foi dividido em duas funções:
  - `attemptClassifyBatch`: a lógica de uma tentativa (com o retry de 429 já existente); ao esgotar os retries ou detectar resposta malformada/tamanho incompatível, agora lança um `BatchClassificationError` (com uma flag `isRateLimited`) em vez de aplicar `fallback()` direto.
  - `classifyBatch` (novo comportamento): chama `attemptClassifyBatch`; se falhar:
    - **Erro de cota (429) esgotada** → aplica `fallback()` no lote inteiro imediatamente, **sem** dividir (dividir não ajudaria — a cota vale para qualquer sub-lote da mesma chamada).
    - **Qualquer outro erro** (JSON malformado, tamanho de resposta incompatível, timeout, erro de rede pontual) e o lote tem mais de 1 item → **divide o lote ao meio e tenta cada metade recursivamente**, isolando o problema até o nível de item único.
    - Item único que ainda falha → só ele cai em `fallback()`, os demais itens do lote original mantêm a classificação real da IA.
- Novo campo `usedFallback?: boolean` em `BatchTransactionResult`, marcado sempre que `fallback()` é usado (por invalidação de item, por esgotamento de cota, ou por falha isolada) — usado pela Etapa 3 para observabilidade.

**Arquivos afetados:** `detect-transactions-batch-with-ia.ts`, `detect-transactions-batch-with-ia.test.ts` (novo — mocka `@google/generative-ai` e `@/lib/prisma` diretamente, já que não havia teste dedicado a esse arquivo).

**Critério de aceite:** ✅ validado por teste — um lote de 4 transações onde só uma ("POISON_ITEM") sempre causa erro na chamada à IA resulta em fallback **apenas** para essa transação; as outras 3 mantêm a classificação real (teste "isolates a single problematic transaction instead of collapsing the whole batch to OTHER"). Um segundo teste confirma que 429 persistente aplica fallback ao lote inteiro sem tentativas extras de split (4 chamadas no total, nem uma a mais).

---

## Etapa 3 — Observabilidade da degradação de classificação ✅ Implementado (parte de log; parte de persistência no ImportJob ficou de fora)

**Objetivo:** tornar visível quando uma importação teve categorização degradada (fallback aplicado), em vez de só aparecer como `console.error`/`console.warn` solto no servidor.

**O que foi implementado:**
- `ImportService.import` (`src/service/import-service.ts`) agora conta, para cada importação:
  - `aiFallbackCount`: quantas transações vieram com `classification.usedFallback = true` (IA não conseguiu classificar de verdade).
  - `unrescuedFallbackCount`: dessas, quantas **também não** tiveram a categoria resgatada pelo dicionário do CSV (Etapa 1) — ou seja, quantas realmente ficaram com categoria "Outros" no fim das contas. Uma transação pode ter `usedFallback = true` (IA falhou) mas ainda assim terminar com a categoria correta, se o CSV já a tinha reconhecido.
  - Se `aiFallbackCount > 0`, loga um `logger.warn({ jobId, userId, total, aiFallbackCount, unrescuedFallbackCount }, 'Importação teve classificação degradada (fallback) da IA para parte das transações')`, correlacionado ao `jobId` — usando o `pino` já configurado em `src/lib/logger.ts` (inclusive já integrado ao Grafana Loki em produção, conforme `GRAFANA_CLOUD_SETUP.md`).

**O que ficou de fora (não implementado agora):**
- Persistir `fallbackCount` como campo no modelo `ImportJob` (exigiria migration de banco) e expor isso na resposta de `GetImportJobStatusUseCase` para o frontend avisar o usuário. Ficou como está no plano original: opcional, fora do escopo imediato. Se quiser que eu faça essa parte também, é só pedir.

**Arquivos afetados:** `detect-transactions-batch-with-ia.ts` (+`usedFallback`), `import-service.ts`, `import-service-fallback-logging.test.ts` (novo).

**Critério de aceite:** ✅ validado por teste — uma importação com 1 transação em fallback (de 2) gera exatamente um `logger.warn` com `aiFallbackCount: 1`; uma importação sem nenhum fallback não loga nada; e uma transação com fallback de IA mas categoria resgatada pelo CSV conta em `aiFallbackCount` mas **não** em `unrescuedFallbackCount`.

---

## Ordem e dependências

- **Etapa 1**: resolve a causa raiz nº1, reduz drasticamente a dependência da IA e a exposição à causa raiz nº2 para a maioria das transações do Inter. **Feita.**
- **Etapa 2**: independente da Etapa 1, mas só continua relevante para os itens que sobrarem sem categoria reconhecida no CSV (menos itens após a Etapa 1, mas ainda necessária para outros bancos/formatos sem coluna de categoria, e para `type`/`paymentMethod`, que sempre passam pela IA). **Feita.**
- **Etapa 3**: independente das outras duas, mas mede melhor a realidade já com a Etapa 2 aplicada (fallback isolado por item, não por lote inteiro). **Feita (parte de log).**

## Estado atual da suíte

Após as três etapas: **108/108 testes passando**, `tsc --noEmit` limpo, `pnpm run build` e `pnpm run test:coverage` executados localmente sem erro (thresholds de cobertura do projeto continuam do mesmo patamar de antes das mudanças).

## Pendências / próximos passos

1. **Validar o dicionário com dados reais.** Ainda preciso de um export real (ou a lista de valores distintos) da coluna de categoria do CSV do Inter para conferir/ajustar as chaves de `csv-category-dictionary.ts` — hoje elas são uma suposição razoável, não um dado confirmado.
2. Decidir se vale a pena persistir `fallbackCount` no `ImportJob` (migration) e expor no status da importação para o usuário final ver na UI que uma importação teve categorização parcialmente degradada.
