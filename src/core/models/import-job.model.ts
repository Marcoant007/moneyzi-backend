import { ImportJobStatus } from '@prisma/client'

export interface ImportJobModel {
    id: string
    userId: string
    status: ImportJobStatus
    total: number
    processed: number
    createdAt: Date
    updatedAt: Date
}
