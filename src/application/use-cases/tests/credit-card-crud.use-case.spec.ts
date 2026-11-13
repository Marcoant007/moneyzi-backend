import { describe, it, expect, vi } from 'vitest'
import { ZodError } from 'zod'
import { UpdateCreditCardUseCase } from '../credit-card-use-case/update-credit-card.use-case'
import { DeleteCreditCardUseCase } from '../credit-card-use-case/delete-credit-card.use-case'
import { CreateCreditCardUseCase } from '../credit-card-use-case/create-credit-card.use-case'
import { CreditCardNotFoundError } from '../credit-card-use-case/credit-card.schemas'
import type { CreditCardRepository } from '@/core/repositories/credit-card-repository'
import type { UserRepository } from '@/application/repositories/user-repository'

const ownedCard = { id: 'card-1', userId: 'user-1' }

function makeRepo(card: unknown = ownedCard) {
    return {
        findById: vi.fn().mockResolvedValue(card),
        update: vi.fn().mockImplementation(async (_id, data) => ({ ...ownedCard, ...data })),
        delete: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockImplementation(async (data) => ({ id: 'new', ...data })),
    }
}

describe('UpdateCreditCardUseCase', () => {
    it('accepts limit: null (empty field) and passes it through to clear the limit', async () => {
        const repo = makeRepo()
        const sut = new UpdateCreditCardUseCase(repo as unknown as CreditCardRepository)

        await sut.execute('card-1', 'user-1', {
            name: 'Inter',
            limit: null,
            closingDay: 1,
            dueDay: 10,
            color: '#64748b',
            bank: 'inter',
        })

        expect(repo.update).toHaveBeenCalledWith('card-1', expect.objectContaining({ limit: null, color: '#64748b' }))
    })

    it('rejects invalid values with a ZodError (→ 400, not 500)', async () => {
        const sut = new UpdateCreditCardUseCase(makeRepo() as unknown as CreditCardRepository)

        await expect(sut.execute('card-1', 'user-1', { limit: 0 })).rejects.toBeInstanceOf(ZodError)
        await expect(sut.execute('card-1', 'user-1', { dueDay: 32 })).rejects.toBeInstanceOf(ZodError)
        await expect(sut.execute('card-1', 'user-1', { lastFourDigits: '12a4' })).rejects.toBeInstanceOf(ZodError)
        await expect(sut.execute('card-1', 'user-1', { color: 'orange' })).rejects.toBeInstanceOf(ZodError)
        await expect(sut.execute('card-1', 'user-1', { name: '   ' })).rejects.toBeInstanceOf(ZodError)
    })

    it('normalizes an empty bank to null', async () => {
        const repo = makeRepo()
        const sut = new UpdateCreditCardUseCase(repo as unknown as CreditCardRepository)
        await sut.execute('card-1', 'user-1', { bank: '' })
        expect(repo.update).toHaveBeenCalledWith('card-1', expect.objectContaining({ bank: null }))
    })

    it("refuses to edit someone else's card", async () => {
        const repo = makeRepo({ id: 'card-1', userId: 'other-user' })
        const sut = new UpdateCreditCardUseCase(repo as unknown as CreditCardRepository)

        await expect(sut.execute('card-1', 'user-1', { name: 'x' })).rejects.toBeInstanceOf(CreditCardNotFoundError)
        expect(repo.update).not.toHaveBeenCalled()
    })
})

describe('DeleteCreditCardUseCase', () => {
    it('only deletes cards owned by the user', async () => {
        const repo = makeRepo({ id: 'card-1', userId: 'other-user' })
        const sut = new DeleteCreditCardUseCase(repo as unknown as CreditCardRepository)
        await expect(sut.execute('card-1', 'user-1')).rejects.toBeInstanceOf(CreditCardNotFoundError)
        expect(repo.delete).not.toHaveBeenCalled()

        const own = makeRepo()
        await new DeleteCreditCardUseCase(own as unknown as CreditCardRepository).execute('card-1', 'user-1')
        expect(own.delete).toHaveBeenCalledWith('card-1')
    })
})

describe('CreateCreditCardUseCase', () => {
    it('creates a card without a limit', async () => {
        const repo = makeRepo()
        const users = { findById: vi.fn().mockResolvedValue({ id: 'user-1' }) } as unknown as UserRepository
        const sut = new CreateCreditCardUseCase(repo as unknown as CreditCardRepository, users)

        await sut.execute({ name: 'Nubank', limit: null, lastFourDigits: '1234', brand: 'MASTERCARD', userId: 'user-1' })
        expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ limit: null }))
    })
})
