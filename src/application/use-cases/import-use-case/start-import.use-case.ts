import { ImportService } from '@/service/import-service'
import { ImportJobDto } from '@/core/dtos/import-job.dto'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { UserRepository } from '@/application/repositories/user-repository'
import type { CreditCardRepository } from '@/core/repositories/credit-card-repository'
import { CsvRegion, DEFAULT_CSV_REGION } from '@/core/types/csv-region'
import { ImportJobStatus } from '@prisma/client'
import { isQueueReady, QueueUnavailableError } from '@/infra/queue/rabbitmq/rabbitmq'

export class StartImportUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly importJobRepository: ImportJobRepository,
        private readonly creditCardRepository: Pick<CreditCardRepository, 'findById'>,
    ) { }

    async execute(input: {
        userId: string;
        fileBuffer: Buffer;
        creditCardId?: string;
        isCreditCardInvoice?: boolean;
        region?: CsvRegion;
    }): Promise<{ job: ImportJobDto }> {
        const region = input.region ?? DEFAULT_CSV_REGION
        const userId = input.userId.trim()
        if (!userId) {
            throw new Error('Usuário inválido')
        }

        console.log('Finding user with ID:', userId)
        const user = await this.userRepository.findById(userId)
        if (!user) {
            throw new Error('Usuário não encontrado')
        }

        // O cartão vem do formulário: sem esta checagem dava para importar
        // transações para o cartão (e a fatura) de outro usuário.
        if (input.creditCardId) {
            const card = await this.creditCardRepository.findById(input.creditCardId)
            if (!card || card.userId !== userId) {
                throw new Error('Erro ao processar arquivo: cartão não encontrado')
            }
        }

        console.log('User found, parsing file buffer of size:', input.fileBuffer.length)
        let parsed: any[]
        try {
            // Mesmas regras de filtragem do ImportService.import: o total do job precisa
            // bater com o número de mensagens publicadas, senão ele nunca vira COMPLETED.
            parsed = ImportService.prepareRows(
                ImportService.parseOnly(input.fileBuffer, region),
                input.isCreditCardInvoice,
            )
            console.log('File parsed successfully, found', parsed.length, 'transactions')
        } catch (error) {
            console.error('Error parsing file:', error)
            throw new Error('Erro ao processar arquivo: ' + (error instanceof Error ? error.message : 'Formato inválido'))
        }

        // Sem linhas, nenhuma mensagem é publicada e o job ficaria em PROCESSING para sempre.
        if (parsed.length === 0) {
            // Prefixo "Erro ao processar arquivo:" faz o controller responder 400 com a mensagem.
            throw new Error('Erro ao processar arquivo: nenhuma compra encontrada. Verifique se o arquivo tem as colunas de data, descrição e valor.')
        }

        // Falha rápido: sem fila não adianta gastar minutos classificando com a IA
        // pra só no fim descobrir que não dá pra publicar as transações.
        if (!isQueueReady()) {
            throw new QueueUnavailableError()
        }

        console.log('Creating import job for user:', userId)
        let job: any
        try {
            job = await this.importJobRepository.create({
                userId,
                total: parsed.length,
                processed: 0,
                creditCardId: input.creditCardId,
                isCreditCardInvoice: input.isCreditCardInvoice || false,
            })
            console.log('Import job created with ID:', job.id)
        } catch (error) {
            console.error('Error creating import job:', error)
            throw new Error('Erro ao criar job de importação: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
        }

        // A classificação com IA leva vários segundos. Ela roda depois da resposta:
        // o app recebe o job na hora e acompanha o status por GET /import/:id, em vez
        // de deixar o usuário parado no modal esperando a IA terminar.
        console.log('Starting import process in background...')
        const jobId = job.id
        void ImportService.import(
            input.fileBuffer,
            userId,
            jobId,
            input.creditCardId,
            input.isCreditCardInvoice,
            region,
        )
            .then(() => console.log('Import process published all rows for job', jobId))
            .catch(async (error) => {
                console.error('Error running import process:', error)
                // Sem isso o job fica travado em PROCESSING para sempre quando o envio
                // para a fila falha (ex.: conexao com RabbitMQ caida) antes de publicar
                // qualquer mensagem. O app vê FAILED no polling e avisa o usuário.
                try {
                    await this.importJobRepository.markStatus(jobId, ImportJobStatus.FAILED)
                } catch (markError) {
                    console.error('Error marking import job as failed:', markError)
                }
            })

        const dto: ImportJobDto = {
            id: job.id,
            userId: job.userId,
            status: job.status,
            total: job.total,
            processed: job.processed,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        }

        return { job: dto }
    }
}
