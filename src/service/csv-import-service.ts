import { parseCsv } from '@/utils/parse-csv'
import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'
import { TransactionMessage } from '@/core/types/transaction-message'

export class CsvImportService {
    static async import(buffer: Buffer, userId: string) {
        const parsed = parseCsv(buffer)

        for (const transaction of parsed) {
            const message: TransactionMessage = {
                ...transaction,
                userId,
            }
            publishToQueue(message)
        }
    }
}
