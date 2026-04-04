import Redis from 'ioredis'
import logger from '@/lib/logger'
import { getRequiredEnv } from '@/utils/required-env'

export const redis = new Redis(getRequiredEnv('REDIS_URL'))

redis.on('connect', () => logger.info('Redis conectado'))
redis.on('error', (err: unknown) => {
    if (err instanceof Error) {
        console.error('Erro no Redis:', err.message)
        if (err.stack) console.error(err.stack)
    } else {
        console.error('Erro no Redis:', err)
    }
})
