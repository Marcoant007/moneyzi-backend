import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const { $transaction } = vi.hoisted(() => ({ $transaction: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction } }))

import { PrismaCategoryUnitOfWork } from '../prisma-category-unit-of-work'

function fakeTx() {
    return {
        category: { findMany: vi.fn().mockResolvedValue([]) },
        mcpAuditLog: { create: vi.fn().mockResolvedValue({ id: 'op-1' }), update: vi.fn(), findFirst: vi.fn() },
        transaction: {},
    }
}

describe('PrismaCategoryUnitOfWork', () => {
    beforeEach(() => vi.clearAllMocks())

    it('runs the work in ONE interactive transaction, Serializable, with a timeout that fits a large merge', async () => {
        const tx = fakeTx()
        $transaction.mockImplementation(async (callback: any) => callback(tx))

        const result = await new PrismaCategoryUnitOfWork().run(async () => 'done')

        expect(result).toBe('done')
        expect($transaction).toHaveBeenCalledTimes(1)
        const options = $transaction.mock.calls[0][1]
        expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable)
        expect(options.timeout).toBeGreaterThan(5000)
    })

    it('hands the work repositories bound to the transaction client — reads AND the audit write share the transaction', async () => {
        const tx = fakeTx()
        $transaction.mockImplementation(async (callback: any) => callback(tx))

        await new PrismaCategoryUnitOfWork().run(async ({ categoryRepository, mcpAuditLogRepository }) => {
            await categoryRepository.listByUserId('user-1')
            await mcpAuditLogRepository.create({ userId: 'user-1', tool: 'merge_categories', params: {}, previousState: {}, newState: {} })
        })

        expect(tx.category.findMany).toHaveBeenCalled()
        expect(tx.mcpAuditLog.create).toHaveBeenCalled()
    })

    it('propagates the error from the work (the transaction rolls back) untouched', async () => {
        $transaction.mockImplementation(async (callback: any) => callback(fakeTx()))

        await expect(new PrismaCategoryUnitOfWork().run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    })

    it('translates a Serializable conflict (P2034) into an actionable CONCURRENT_MODIFICATION error', async () => {
        $transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' }))

        await expect(new PrismaCategoryUnitOfWork().run(async () => 'x')).rejects.toThrow(/CONCURRENT_MODIFICATION.*Nada foi alterado/)
    })

    it('does not swallow other Prisma errors', async () => {
        $transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }))

        await expect(new PrismaCategoryUnitOfWork().run(async () => 'x')).rejects.toThrow('unique')
    })
})
