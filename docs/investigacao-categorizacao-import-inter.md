# Investigação: categorização incorreta ao importar fatura do Inter (tudo cai em "Outros")

## Resumo

O CSV do Inter já traz uma coluna de categoria, mas **essa informação nunca é usada como fonte de verdade**. Ela só chega até o modelo de IA como uma "dica" de texto dentro do prompt — e o próprio uso de IA em lote tem um comportamento em que **um único erro joga o lote inteiro (até 50 transações) para a categoria "Outros"**. Os dois problemas juntos explicam o sintoma relatado.

## Fluxo atual, passo a passo

1. **Upload** → `POST /import` → `ImportController.importCsv` → `StartImportUseCase.execute` (`moneyzi-backend/src/application/use-cases/import-use-case/start-import.use-case.ts`).
2. `StartImportUseCase` chama `ImportService.parseOnly` (só para contar linhas) e depois `ImportService.import` (`moneyzi-backend/src/service/import-service.ts`), que é quem de fato processa o arquivo.
3. Dentro de `ImportService.import`:
   - `parseCsv(buffer)` (`moneyzi-backend/src/utils/parse-csv.ts`) lê o CSV e, por linha, chama `parseCsvRow` (`moneyzi-backend/src/utils/parse-csv-row.ts`).
   - `parseCsvRow` **só** aceita o valor da coluna de categoria como `transaction.category` se ele bater **exatamente** (case-sensitive) com uma das chaves internas do enum `TransactionCategory` — que são em inglês e maiúsculas: `HOUSING`, `TRANSPORTATION`, `FOOD`, `ENTERTAINMENT`, `HEALTH`, `UTILITY`, `SALARY`, `EDUCATION`, `OTHER`, `SIGNATURE`, `FOOD_DELIVERY`, `GAMING`, `SERVICES`, `STREAMING` (ver `moneyzi-backend/prisma/schema.prisma:72-87`).
   - O CSV do Inter traz texto livre em português (ex.: "Supermercado", "Compras", "Serviços", "Lazer", "Transporte"...). Isso **nunca** bate com o enum em inglês, então `transaction.category` fica `undefined`. O valor original é preservado apenas em `transaction.rawCategoryText` (`parse-csv-row.ts:49`).
   - Confirmação de que isso é o comportamento esperado hoje: o único teste que cobre esse caminho (`moneyzi-backend/src/utils/tests/parse-csv-row.test.ts`) usa `Categoria: 'FOOD'` — ou seja, testa exatamente o caso que não acontece na vida real (o banco nunca vai escrever `"FOOD"` no CSV).
4. Ainda em `ImportService.import`, antes de publicar na fila, é feita uma **pré-classificação em lote**: `detectTransactionsBatchWithIA(userId, batchInputs)` (`moneyzi-backend/src/core/gemini/detect-transactions-batch-with-ia.ts`), onde `batchInputs` usa `rawCategory: t.category ? String(t.category) : (t.rawCategoryText ?? undefined)` (`import-service.ts:63-66`). Ou seja, a categoria do Inter só entra como **dica textual dentro do prompt** enviado ao Gemini (`"1. \"nome da transação\" (categoria: \"Supermercado\")"`), não como valor definitivo.
5. O Gemini recebe essa dica e tenta escolher entre as categorias do próprio usuário + o enum interno — ele pode ignorar a dica, é apenas um "prefira isso se fizer sentido".
6. Se a chamada ao Gemini falhar de qualquer forma que não seja 429 (erro de rede, chave inválida/sem cota, timeout, ou resposta que não é um JSON válido/array do tamanho esperado), o código devolve `fallback()` **para todos os itens daquele lote inteiro**:
   ```ts
   // detect-transactions-batch-with-ia.ts:79-82 e :119-120
   if (!Array.isArray(parsed) || parsed.length !== items.length) {
       return items.map(() => fallback())   // <- lote inteiro vira OTHER
   }
   ...
   } catch (error) {
       return items.map(() => fallback())   // <- lote inteiro vira OTHER
   }

   function fallback() {
       return { type: 'EXPENSE', category: 'OTHER', paymentMethod: 'CREDIT_CARD' }
   }
   ```
   Como uma fatura do Inter facilmente tem 30–80 lançamentos, e o lote é de até 50 (`BATCH_SIZE = 50`), **um único problema na chamada (timeout, resposta cortada, erro de autenticação/cota da API do Gemini) derruba a fatura inteira para "Outros"** — exatamente o sintoma relatado.
7. Nada disso fica visível para o usuário: não há log estruturado nem estado no `ImportJob` indicando "classificação falhou, categorias padrão aplicadas". Só aparece o `console.error`/`console.warn` no servidor.
8. Quando a mensagem chega na fila e passa pelo `GeminiCategorizationHandler` (`moneyzi-backend/src/core/handlers/gemini-categorization-handler.ts`), ele só chama a IA de novo se `type`/`category`/`paymentMethod` estiverem faltando — e como o passo 6 sempre preenche os três (mesmo que com o fallback), esse handler é essencialmente um no-op para importações de CSV. A decisão real acontece 100% no passo 4–6, dentro de `ImportService.import`.

## Causas raiz identificadas

1. **A categoria do CSV nunca é tratada como fonte de verdade.** O match direto em `parseCsvRow` só funciona se o CSV trouxer literalmente as chaves do enum em inglês, o que não acontece com nenhum banco real (Inter incluso). Isso torna esse branch de código morto na prática, e faz com que **toda** categorização passe pela IA, mesmo quando o banco já mandou a informação certa.
2. **Falha de IA em lote derruba o lote inteiro para "Outros"**, em vez de isolar apenas os itens que falharam. Não há retry por item nem log correlacionado ao `ImportJob`.
3. **Mesmo quando a IA funciona, ela não é obrigada a respeitar a categoria vinda do banco** — `rawCategory` é só uma sugestão no prompt, o modelo pode escolher outra coisa livremente.

## O que ainda falta confirmar (para saber qual causa pesa mais no caso real)

Não tenho acesso aos logs de produção/Railway, então não dá pra afirmar com certeza se o gatilho específico da fatura do usuário foi timeout, erro 429 (cota do Gemini), chave `GEMINI_API_KEY` inválida/ausente no ambiente, ou resposta truncada por lote grande. Vale checar nos logs do backend (Railway) por mensagens como:
- `"Erro na classificação em batch:"` (erro genérico → cai no catch → lote inteiro OTHER)
- `"Batch response length mismatch"` (resposta do Gemini veio com tamanho diferente do esperado)
- `"Gemini timeout after Xms"`
- `"Gemini batch rate limit (429)"`

durante o horário em que a fatura foi importada. Isso confirma qual dos gatilhos do passo 6 está ocorrendo.

## Direção de correção proposta (ainda não implementada)

1. **Tratar a categoria do CSV como fonte primária quando reconhecida**, em vez de só uma dica pro Gemini: criar um mapeamento (dicionário) das categorias que o Inter usa (ex.: "Supermercado", "Compras", "Serviços", "Transporte", "Lazer" etc. — preciso confirmar os valores exatos que aparecem no CSV real) para o enum interno / categoria do usuário, e só cair para a IA quando o CSV não trouxer categoria ou ela for desconhecida.
2. **Tornar a falha de classificação em lote granular**: se o lote inteiro falhar, tentar novamente item a item (ou em sub-lotes menores) antes de aplicar o fallback, para não jogar transações classificáveis para "Outros" por causa de uma transação problemática ou um erro transitório.
3. **Registrar no `ImportJob` (ou nos logs) quando o fallback foi aplicado**, para o usuário/dev saber que uma importação teve classificação degradada, em vez de descobrir só olhando a lista de transações depois.

Quer que eu implemente a opção 1 primeiro (mapeamento direto das categorias do Inter), ou prefere que eu já ataque as três juntas?
