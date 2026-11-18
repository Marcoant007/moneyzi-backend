import { createImportJobNotifier } from '@/application/services/import-job-notifier'
import { PrismaNotificationRepository } from '@/infra/repositories/prisma/prisma-notification-repository'
import { prisma } from '@/lib/prisma'

/** Default notifier wired to Prisma (bell notification + card name lookup). */
export const notifyImportFinished = createImportJobNotifier({
    notificationRepository: new PrismaNotificationRepository(),
    findCardName: async (creditCardId) => {
        const card = await prisma.creditCard.findUnique({ where: { id: creditCardId }, select: { name: true } })
        return card?.name ?? null
    },
})
