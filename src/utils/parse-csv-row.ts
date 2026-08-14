import { ParsedTransaction } from '@/core/dtos/parsed-transaction.dto'
import { TransactionCategory, TransactionPaymentMethod, TransactionType } from '@prisma/client'
import { resolveCategoryFromText } from './csv-category-dictionary'
import { CsvRegion, DEFAULT_CSV_REGION } from '@/core/types/csv-region'

// BR: "R$ 1.234,56" -> ponto é milhar, vírgula é decimal.
// US: "$1,234.56"   -> vírgula é milhar, ponto é decimal (já no formato que parseFloat espera).
function parseAmount(value: string, region: CsvRegion): number {
    const cleaned = value.replace(/\s/g, '').replace(/[R$]/g, '')
    return region === 'US'
        ? Number.parseFloat(cleaned.replace(/,/g, ''))
        : Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
}

// BR: DD/MM/AAAA. US: MM/DD/AAAA. Ambos viram ISO (AAAA-MM-DD) antes do Date().
function parseDateValue(value: string, region: CsvRegion): Date {
    let isoStr = value
    if (value.includes('/')) {
        const parts = value.split('/').map((part) => part.trim())
        if (parts.length === 3) {
            const [a, b, year] = parts
            const [month, day] = region === 'US' ? [a, b] : [b, a]
            isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
        }
    }
    // Parsear como meio-dia UTC evita que o offset UTC-3 do Brasil
    // jogue a data para o dia anterior quando exibida localmente.
    return new Date(`${isoStr}T12:00:00.000Z`)
}

export function parseCsvRow(
    row: Record<string, string>,
    headerMap: Record<string, keyof ParsedTransaction>,
    region: CsvRegion = DEFAULT_CSV_REGION
): Partial<ParsedTransaction> {
    const transaction: Partial<ParsedTransaction> = {}

    for (const [csvKey, rawValue] of Object.entries(row)) {
        const field = headerMap[csvKey]
        if (!field || !rawValue.trim()) continue

        const value = rawValue.trim()

        switch (field) {
            case 'amount':
                transaction.amount = parseAmount(value, region)
                break

            case 'date':
                transaction.date = parseDateValue(value, region)
                break

            case 'name':
                transaction.name = value
                break

            case 'type':
                if (Object.values(TransactionType).includes(value as TransactionType)) {
                    transaction.type = value as TransactionType
                }
                break

            case 'category':
                transaction.rawCategoryText = value
                if (Object.values(TransactionCategory).includes(value as TransactionCategory)) {
                    transaction.category = value as TransactionCategory
                } else {
                    // Bancos como o Inter já entregam a categoria pronta no CSV, só que em
                    // texto livre em português — tentamos casar com o dicionário antes de
                    // depender da IA (ver docs/plano-correcao-categorizacao-import-inter.md).
                    const resolved = resolveCategoryFromText(value)
                    if (resolved) {
                        transaction.category = resolved.category
                        transaction.categoryName = resolved.categoryName
                    }
                }
                break

            case 'paymentMethod':
                if (
                    Object.values(TransactionPaymentMethod).includes(value as TransactionPaymentMethod)
                ) {
                    transaction.paymentMethod = value as TransactionPaymentMethod
                }
                break
        }
    }

    return transaction
}
