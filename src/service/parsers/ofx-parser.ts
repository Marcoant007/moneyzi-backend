import { ParsedTransaction } from '@/core/dtos/parsed-transaction.dto'

function extractTag(block: string, tag: string) {
    const regex = new RegExp(`<${tag}>([^<\r\n]+)`, 'i')
    const match = block.match(regex)
    return match ? match[1].trim() : undefined
}

function parseOfxDate(value?: string): Date | undefined {
    if (!value) return undefined
    const digits = value.replace(/[^0-9]/g, '')
    if (digits.length >= 8) {
        const y = digits.substring(0, 4)
        const m = digits.substring(4, 6)
        const d = digits.substring(6, 8)
        return new Date(`${y}-${m}-${d}`)
    }
    return undefined
}

export class OfxParser {
    static parse(buffer: Buffer): Partial<ParsedTransaction>[] {
        const content = buffer.toString('utf-8')

        const blocks = content.split(/<STMTTRN>/i).slice(1)
        const transactions: Partial<ParsedTransaction>[] = []

        for (const raw of blocks) {
            const block = raw.split(/<\/STMTTRN>/i)[0]

            const date = parseOfxDate(extractTag(block, 'DTPOSTED'))
            const amountRaw = extractTag(block, 'TRNAMT')
            const name = extractTag(block, 'NAME') || extractTag(block, 'MEMO')

            const amount = amountRaw ? Number.parseFloat(amountRaw) : undefined

            const tx: Partial<ParsedTransaction> = {}
            if (date) tx.date = date
            if (amount !== undefined && !Number.isNaN(amount)) tx.amount = amount
            if (name) tx.name = name

            transactions.push(tx)
        }

        return transactions
    }
}
