import { TransactionCategory } from '@prisma/client'

export interface CategoryDictionaryEntry {
    category: TransactionCategory
    categoryName: string
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/**
 * Mapeia o texto de categoria que já vem pronto no CSV do banco (ex.: coluna
 * "Categoria" da fatura do Inter) para o enum interno + o nome de categoria
 * do usuário (mesmos nomes usados em scripts/seed-categories.ts, para casar
 * com categorias que o usuário já possui).
 *
 * Lista construída com categorias conhecidas do Inter/mercado financeiro
 * brasileiro — ainda precisa ser validada/ajustada contra um export real do
 * CSV do Inter (ver docs/plano-correcao-categorizacao-import-inter.md,
 * Etapa 1). Ajuste ou complemente as chaves abaixo com os valores reais
 * assim que tivermos uma amostra.
 */
const CATEGORY_SYNONYMS: Record<string, CategoryDictionaryEntry> = {
    'supermercado': { category: 'FOOD', categoryName: 'Alimentação' },
    'mercado': { category: 'FOOD', categoryName: 'Alimentação' },
    'alimentacao': { category: 'FOOD', categoryName: 'Alimentação' },
    'restaurante': { category: 'FOOD', categoryName: 'Alimentação' },
    'restaurantes': { category: 'FOOD', categoryName: 'Alimentação' },
    'padaria': { category: 'FOOD', categoryName: 'Alimentação' },

    'ifood': { category: 'FOOD_DELIVERY', categoryName: 'Lanche' },
    'delivery': { category: 'FOOD_DELIVERY', categoryName: 'Lanche' },
    'lanchonete': { category: 'FOOD_DELIVERY', categoryName: 'Lanche' },
    'fast food': { category: 'FOOD_DELIVERY', categoryName: 'Lanche' },

    'transporte': { category: 'TRANSPORTATION', categoryName: 'Transporte' },
    'uber': { category: 'TRANSPORTATION', categoryName: 'Transporte' },
    'combustivel': { category: 'TRANSPORTATION', categoryName: 'Transporte' },
    'posto': { category: 'TRANSPORTATION', categoryName: 'Transporte' },
    'estacionamento': { category: 'TRANSPORTATION', categoryName: 'Transporte' },
    'pedagio': { category: 'TRANSPORTATION', categoryName: 'Transporte' },

    'lazer': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },
    'entretenimento': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },
    'entretenimento e lazer': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },
    'cinema': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },
    'viagem': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },
    'viagens': { category: 'ENTERTAINMENT', categoryName: 'Entretenimento' },

    'saude': { category: 'HEALTH', categoryName: 'Saúde' },
    'farmacia': { category: 'HEALTH', categoryName: 'Saúde' },
    'plano de saude': { category: 'HEALTH', categoryName: 'Saúde' },
    'academia': { category: 'HEALTH', categoryName: 'Saúde' },

    'utilidades': { category: 'UTILITY', categoryName: 'Utilidades' },
    'contas': { category: 'UTILITY', categoryName: 'Utilidades' },
    'contas e servicos': { category: 'UTILITY', categoryName: 'Utilidades' },
    'agua': { category: 'UTILITY', categoryName: 'Utilidades' },
    'luz': { category: 'UTILITY', categoryName: 'Utilidades' },
    'energia': { category: 'UTILITY', categoryName: 'Utilidades' },
    'internet': { category: 'UTILITY', categoryName: 'Utilidades' },
    'telefone': { category: 'UTILITY', categoryName: 'Utilidades' },
    'celular': { category: 'UTILITY', categoryName: 'Utilidades' },

    'educacao': { category: 'EDUCATION', categoryName: 'Educação' },
    'curso': { category: 'EDUCATION', categoryName: 'Educação' },
    'cursos': { category: 'EDUCATION', categoryName: 'Educação' },
    'escola': { category: 'EDUCATION', categoryName: 'Educação' },
    'faculdade': { category: 'EDUCATION', categoryName: 'Educação' },
    'livros': { category: 'EDUCATION', categoryName: 'Educação' },

    'casa': { category: 'HOUSING', categoryName: 'Moradia' },
    'moradia': { category: 'HOUSING', categoryName: 'Moradia' },
    'aluguel': { category: 'HOUSING', categoryName: 'Moradia' },
    'condominio': { category: 'HOUSING', categoryName: 'Moradia' },

    'servicos': { category: 'SERVICES', categoryName: 'Serviços' },
    'servicos financeiros': { category: 'SERVICES', categoryName: 'Serviços' },

    'assinatura': { category: 'SIGNATURE', categoryName: 'Assinatura' },
    'assinaturas': { category: 'SIGNATURE', categoryName: 'Assinatura' },
    'assinaturas e servicos': { category: 'SIGNATURE', categoryName: 'Assinatura' },

    'streaming': { category: 'STREAMING', categoryName: 'Streaming' },

    'jogos': { category: 'GAMING', categoryName: 'Jogos' },
    'games': { category: 'GAMING', categoryName: 'Jogos' },

    'salario': { category: 'SALARY', categoryName: 'Salário' },
    'receita': { category: 'SALARY', categoryName: 'Salário' },
    'rendimentos': { category: 'SALARY', categoryName: 'Salário' },

    'outros': { category: 'OTHER', categoryName: 'Outros' },
    'diversos': { category: 'OTHER', categoryName: 'Outros' },
    'compras': { category: 'OTHER', categoryName: 'Outros' },
}

export function resolveCategoryFromText(rawText: string): CategoryDictionaryEntry | undefined {
    const normalized = normalize(rawText)
    if (!normalized) return undefined
    return CATEGORY_SYNONYMS[normalized]
}
