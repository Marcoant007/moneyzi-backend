import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isBillingBlocked } from '@/utils/billing-access'

const now = new Date('2026-11-16T12:00:00Z')
const future = new Date('2026-11-20T12:00:00Z')
const past = new Date('2026-11-10T12:00:00Z')

describe('isBillingBlocked', () => {
    it('allows users without a billing record yet', () => {
        expect(isBillingBlocked(null, now)).toBe(false)
    })

    it('allows active, courtesy and running trials', () => {
        expect(isBillingBlocked({ subscriptionStatus: 'ACTIVE', trialEndsAt: past }, now)).toBe(false)
        expect(isBillingBlocked({ subscriptionStatus: 'COURTESY', trialEndsAt: past }, now)).toBe(false)
        expect(isBillingBlocked({ subscriptionStatus: 'TRIAL_ACTIVE', trialEndsAt: future }, now)).toBe(false)
    })

    it('blocks expired trials even before the status is updated', () => {
        expect(isBillingBlocked({ subscriptionStatus: 'TRIAL_ACTIVE', trialEndsAt: past }, now)).toBe(true)
    })

    it('blocks expired, canceled and past-due subscriptions', () => {
        for (const status of ['TRIAL_EXPIRED', 'CANCELED', 'PAST_DUE']) {
            expect(isBillingBlocked({ subscriptionStatus: status, trialEndsAt: future }, now)).toBe(true)
        }
    })
})
