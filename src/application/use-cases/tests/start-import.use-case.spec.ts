import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StartImportUseCase } from '@/application/use-cases/import-use-case/start-import.use-case'
import { ImportService } from '@/service/import-service'

vi.mock('@/service/import-service', () => ({
    ImportService: {
        parseOnly: vi.fn().mockReturnValue([{ name: 'Padaria', amount: 12.5 }]),
        import: vi.fn().mockResolvedValue(undefined),
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

    return { userRepository, importJobRepository }
}

describe('StartImportUseCase', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(ImportService.parseOnly).mockReturnValue([{ name: 'Padaria', amount: 12.5 }])
        vi.mocked(ImportService.import).mockResolvedValue(undefined as any)
    })

    it('defaults region to BR when not provided', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository)

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
        const { userRepository, importJobRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository)

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

    it('trims userId before looking up the user', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository)

        await sut.execute({ userId: '  user-1  ', fileBuffer: Buffer.from('csv') })

        expect(userRepository.findById).toHaveBeenCalledWith('user-1')
    })

    it('throws Usuário inválido for an empty/whitespace userId', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository)

        await expect(
            sut.execute({ userId: '   ', fileBuffer: Buffer.from('csv') }),
        ).rejects.toThrow('Usuário inválido')
    })

    it('throws Usuário não encontrado when the user repository returns null', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        userRepository.findById.mockResolvedValue(null)
        const sut = new StartImportUseCase(userRepository, importJobRepository)

        await expect(
            sut.execute({ userId: 'ghost', fileBuffer: Buffer.from('csv') }),
        ).rejects.toThrow('Usuário não encontrado')
    })

    it('wraps a parse failure with a descriptive error, regardless of region', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        vi.mocked(ImportService.parseOnly).mockImplementation(() => {
            throw new Error('Invalid CSV')
        })
        const sut = new StartImportUseCase(userRepository, importJobRepository)

        await expect(
            sut.execute({ userId: 'user-1', fileBuffer: Buffer.from('csv'), region: 'US' }),
        ).rejects.toThrow('Erro ao processar arquivo: Invalid CSV')
    })

    it('forwards creditCardId and isCreditCardInvoice alongside region', async () => {
        const { userRepository, importJobRepository } = makeRepositories()
        const sut = new StartImportUseCase(userRepository, importJobRepository)

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
})
