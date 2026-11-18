import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StartImportUseCase } from '@/application/use-cases/import-use-case/start-import.use-case'
import { ImportService } from '@/service/import-service'

vi.mock('@/service/import-service', () => ({
    ImportService: {
        parseOnly: vi.fn().mockReturnValue([{ name: 'Padaria', amount: 12.5 }]),
        prepareRows: vi.fn((rows: unknown[]) => rows),
        import: vi.fn().mockResolvedValue(undefined),
    },
}))

const queue = vi.hoisted(() => ({ ready: true }))

vi.mock('@/infra/queue/rabbitmq/rabbitmq', () => ({
    isQueueReady: () => queue.ready,
    QueueUnavailableError: class QueueUnavailableError extends Error {
        constructor() {
            super('Canal do RabbitMQ nao inicializado.')
            this.name = 'QueueUnavailableError'
        }
    },
}))

function makeJob() {
    return {
        id: 'job-1',
        userId: 'user-1',
        status: 'PROCESSING',
        total: 1,
        processed: 0,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    }
}

function makeRepositories() {
    const userRepository = {
        findById: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as any

    const importJobRepository = {
        create: vi.fn().mockResolvedValue(makeJob()),
    } as any

    const creditCardRepository = {
        findById: vi.fn().mockResolvedValue({ id: 'card-1', userId: 'user-1' }),
    } as any

    return { userRepository, importJobRepository, creditCardRepository }
}

describe('StartImportUseCase', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        queue.ready = true
        vi.mocked(ImportService.parseOnly).mockReturnValue([{ name: 'Padaria', amount: 12.5 }])
        vi.mocked(ImportService.import).mockResolvedValue(undefined as any)
    })

    it('creates the job with the row count left after invoice filtering and rejects files with no purchases', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        vi.mocked(ImportService.parseOnly).mockReturnValue([
            { name: 'Mercado', amount: 10 },
            { name: 'Pagamento recebido', amount: 10 },
        ])
        vi.mocked(ImportService.prepareRows).mockReturnValueOnce([{ name: 'Mercado', amount: 10 }])

        await sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), isCreditCardInvoice: true })

        expect(ImportService.prepareRows).toHaveBeenCalledWith(expect.any(Array), true)
        expect(importJobRepository.create).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }))

        vi.mocked(ImportService.prepareRows).mockReturnValueOnce([])
        await expect(
            sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), isCreditCardInvoice: true }),
        ).rejects.toThrow(/^Erro ao processar arquivo:/)
        expect(importJobRepository.create).toHaveBeenCalledTimes(1)
    })

    it('returns the job before the AI finishes and marks it FAILED if the background import fails', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        importJobRepository.markStatus = vi.fn().mockResolvedValue(undefined)
        let rejectImport: (error: Error) => void = () => {}
        vi.mocked(ImportService.import).mockReturnValue(
            new Promise((_, reject) => {
                rejectImport = reject
            }) as any,
        )
        const useCase = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        // Resolves while ImportService.import is still pending.
        const { job } = await useCase.execute({ userId: 'user-1', fileBuffer: Buffer.from('x') })
        expect(job.id).toBe('job-1')
        expect(importJobRepository.markStatus).not.toHaveBeenCalled()

        rejectImport(new Error('queue down'))
        await vi.waitFor(() =>
            expect(importJobRepository.markStatus).toHaveBeenCalledWith('job-1', 'FAILED'),
        )
    })

    it('leaves a failure notification when the background import fails', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        importJobRepository.markStatus = vi.fn().mockResolvedValue(undefined)
        const notify = vi.fn().mockResolvedValue(undefined)
        vi.mocked(ImportService.import).mockRejectedValue(new Error('queue down'))
        const useCase = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository, notify)

        await useCase.execute({ userId: 'user-1', fileBuffer: Buffer.from('x'), creditCardId: 'card-1' })

        await vi.waitFor(() =>
            expect(notify).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'job-1', userId: 'user-1', status: 'FAILED', creditCardId: 'card-1' }),
            ),
        )
    })

    it('defaults region to BR when not provided', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv') })

        expect(ImportService.parseOnly).toHaveBeenCalledWith(expect.any(Buffer), 'BR')
        expect(ImportService.import).toHaveBeenCalledWith(
            expect.any(Buffer),
            'user-1',
            'job-1',
            undefined,
            undefined,
            'BR',
        )
    })

    it('forwards region=US through parseOnly and import', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), region: 'US' })

        expect(ImportService.parseOnly).toHaveBeenCalledWith(expect.any(Buffer), 'US')
        expect(ImportService.import).toHaveBeenCalledWith(
            expect.any(Buffer),
            'user-1',
            'job-1',
            undefined,
            undefined,
            'US',
        )
    })

    it('fails fast without creating a job or calling the AI when the queue is down', async () => {
        queue.ready = false
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await expect(
            sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('x') }),
        ).rejects.toThrow('Canal do RabbitMQ nao inicializado.')

        expect(importJobRepository.create).not.toHaveBeenCalled()
        expect(ImportService.import).not.toHaveBeenCalled()
    })

    it('trims userId before looking up the user', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await sut.execute({ userId: '  user-1  ', fileBuffer: Buffer.from('csv') })

        expect(userRepository.findById).toHaveBeenCalledWith('user-1')
    })

    it('throws Usuário inválido for an empty/whitespace userId', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await expect(
            sut.execute({ userId: '   ', fileBuffer: Buffer.from('csv') }),
        ).rejects.toThrow('Usuário inválido')
    })

    it('throws Usuário não encontrado when the user repository returns null', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        userRepository.findById.mockResolvedValue(null)
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await expect(
            sut.execute({ userId: 'ghost', fileBuffer: Buffer.from('csv') }),
        ).rejects.toThrow('Usuário não encontrado')
    })

    it('wraps a parse failure with a descriptive error, regardless of region', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        vi.mocked(ImportService.parseOnly).mockImplementation(() => {
            throw new Error('Invalid CSV')
        })
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await expect(
            sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), region: 'US' }),
        ).rejects.toThrow('Erro ao processar arquivo: Invalid CSV')
    })

    it('forwards creditCardId and isCreditCardInvoice alongside region', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await sut.execute({
            userId: 'user-1',
            fileBuffer: Buffer.from('csv'),
            creditCardId: 'card-1',
            isCreditCardInvoice: true,
            region: 'US',
        })

        expect(ImportService.import).toHaveBeenCalledWith(
            expect.any(Buffer),
            'user-1',
            'job-1',
            'card-1',
            true,
            'US',
        )
        expect(importJobRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ creditCardId: 'card-1', isCreditCardInvoice: true }),
        )
    })

    it('rejects importing into a credit card that belongs to another user', async () => {
        const { userRepository, importJobRepository, creditCardRepository } = makeRepositories()
        creditCardRepository.findById.mockResolvedValue({ id: 'card-x', userId: 'someone-else' })
        const sut = new StartImportUseCase(userRepository, importJobRepository, creditCardRepository)

        await expect(
            sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), creditCardId: 'card-x' }),
        ).rejects.toThrow('Erro ao processar arquivo: cartão não encontrado')
        expect(importJobRepository.create).not.toHaveBeenCalled()
        expect(ImportService.import).not.toHaveBeenCalled()
    })
})
