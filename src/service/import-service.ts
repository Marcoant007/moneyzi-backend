import { OfxParser } from './parsers/ofx-parser'
import { parseCsv } from '@/utils/parse-csv'
import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'
import { TransactionMessage } from '@/core/types/transaction-message'

export class ImportService {
    static detectType(buffer: Buffer): 'csv' | 'ofx' | 'unknown' {
        const text = buffer.toString('utf-8', 0, 200).toLowerCase()
        if (text.includes('<ofx') || text.includes('<stmttrn>')) return 'ofx'
        if (text.includes(',') || text.includes(';') || text.includes('date')) return 'csv'
        return 'unknown'
    }

    static parseOnly(buffer: Buffer): Partial<any>[] {
        const type = this.detectType(buffer)

        if (type === 'csv') return parseCsv(buffer)
        if (type === 'ofx') return OfxParser.parse(buffer)

        throw new Error('Tipo de arquivo não suportado')
    }

    static async import(buffer: Buffer, userId: string, jobId?: string) {
        const type = this.detectType(buffer)

        let parsed: Partial<any>[] = []

        if (type === 'csv') {
            parsed = parseCsv(buffer)
        } else if (type === 'ofx') {
            parsed = OfxParser.parse(buffer)
        } else {
            throw new Error('Tipo de arquivo não suportado')
        }

        console.log('Parsed transactions:', parsed.length)
        console.log('First transaction sample:', JSON.stringify(parsed[0], null, 2))

        const normalizedUserId = userId.trim()

        for (const [index, transaction] of parsed.entries()) {
            const message: TransactionMessage = {
                ...transaction,
                userId: normalizedUserId,
                importJobId: jobId,
            }

            console.log(`Sending transaction ${index + 1}/${parsed.length} to queue:`, JSON.stringify({
                userId: message.userId,
                name: message.name,
                amount: message.amount,
                date: message.date,
            }, null, 2))

            publishToQueue(message)
        }
        return parsed
    }
}
