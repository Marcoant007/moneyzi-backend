import { ImportService } from '@/service/import-service'
import { ImportJobDto } from '@/core/dtos/import-job.dto'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { UserRepository } from '@/application/repositories/user-repository'
import { CsvRegion, DEFAULT_CSV_REGION } from '@/core/types/csv-region'
import { ImportJobStatus } from '@prisma/client'

export class StartImportUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly importJobRepository: ImportJobRepository,
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

        console.log('User found, parsing file buffer of size:', input.fileBuffer.length)
        let parsed: any[]
        try {
            parsed = ImportService.parseOnly(input.fileBuffer, region)
            console.log('File parsed successfully, found', parsed.length, 'transactions')
        } catch (error) {
            console.error('Error parsing file:', error)
            throw new Error('Erro ao processar arquivo: ' + (error instanceof Error ? error.message : 'Formato inválido'))
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

        console.log('Starting import process...')
        try {
            await ImportService.import(
                input.fileBuffer,
                userId,
                job.id,
                input.creditCardId,
                input.isCreditCardInvoice,
                region,
            )
            console.log('Import process started successfully')
        } catch (error) {
            console.error('Error starting import process:', error)

            // Sem isso o job fica travado em PROCESSING para sempre quando o envio
            // para a fila falha (ex.: conexao com RabbitMQ caida) antes de publicar
            // qualquer mensagem.
            try {
                await this.importJobRepository.markStatus(job.id, ImportJobStatus.FAILED)
            } catch (markError) {
                console.error('Error marking import job as failed:', markError)
            }

            throw new Error('Erro ao iniciar processamento: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
        }

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
