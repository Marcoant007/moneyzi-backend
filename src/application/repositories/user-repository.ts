import type { User } from '@prisma/client'

export interface UserRepository {
    findById(id: string): Promise<User | null>
}
