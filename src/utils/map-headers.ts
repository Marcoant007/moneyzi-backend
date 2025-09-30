import { ParsedTransaction } from '@/core/dtos/parsed-transaction.dto'

export function mapHeaders(
    headers: string[]
): Record<string, keyof ParsedTransaction> {
    const normalized = (text: string) =>
        text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z]/g, '')

    const result: Record<string, keyof ParsedTransaction> = {}

    for (const original of headers) {
        const key = normalized(original)

        if (key.includes('descricao') || key.includes('nome') || key.includes('titulo')) {
            result[original] = 'name'
        } else if (key.includes('valor') || key.includes('amount')) {
            result[original] = 'amount'
        } else if (key.includes('data')) {
            result[original] = 'date'
        } else if (key.includes('categoria')) {
            result[original] = 'category'
        } else if (key.includes('tipo')) {
            result[original] = 'type'
        } else if (key.includes('pagamento') || key.includes('metodo')) {
            result[original] = 'paymentMethod'
        }
    }

    return result
}
