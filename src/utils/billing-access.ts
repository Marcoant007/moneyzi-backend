import { prisma } from '@/lib/prisma'

// Mesma regra do frontend (moneyzi/app/_lib/billing.ts): só estes status usam o app.
const UNBLOCKED_STATUSES = new Set(['ACTIVE', 'TRIAL_ACTIVE', 'COURTESY'])

export function isBillingBlocked(billing: { subscriptionStatus: string; trialEndsAt: Date } | null, now = new Date()): boolean {
    // Sem registro ainda: o frontend cria o trial no primeiro acesso, então não bloqueia.
    if (!billing) return false
    if (!UNBLOCKED_STATUSES.has(billing.subscriptionStatus)) return true
    return billing.subscriptionStatus === 'TRIAL_ACTIVE' && billing.trialEndsAt.getTime() < now.getTime()
}

export async function isUserBillingBlocked(userId: string): Promise<boolean> {
    const billing = await prisma.billingStatus.findUnique({
        where: { userId },
        select: { subscriptionStatus: true, trialEndsAt: true },
    })
    return isBillingBlocked(billing)
}
