import { prisma } from '@/lib/prisma'
import type { UserRepository } from '@/application/repositories/user-repository'
import type { User } from '@prisma/client'

export class PrismaUserRepository implements UserRepository {
    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({ where: { id } })
    }
}
