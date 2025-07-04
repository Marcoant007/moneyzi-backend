import { parseCsv } from '@/utils/parse-csv'
import { publishToQueue } from '@/infra/queue/rabbitmq/rabbitmq'

export class CsvImportService {
    static async import(buffer: Buffer, userId: string) {
        const parsed = parseCsv(buffer)

        for (const transaction of parsed) {
            publishToQueue({ ...transaction, userId })
        }
    }
}
