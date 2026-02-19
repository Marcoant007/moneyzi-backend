import { ImportService } from '@/service/import-service'
import { ImportJobDto } from '@/core/dtos/import-job.dto'
import type { ImportJobRepository } from '@/application/repositories/import-job-repository'
import type { UserRepository } from '@/application/repositories/user-repository'

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
    }): Promise<{ job: ImportJobDto }> {
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
            parsed = ImportService.parseOnly(input.fileBuffer)
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
            await ImportService.import(input.fileBuffer, userId, job.id, input.creditCardId)
            console.log('Import process started successfully')
        } catch (error) {
            console.error('Error starting import process:', error)
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
