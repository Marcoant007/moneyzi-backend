import Redis from 'ioredis'
import logger from '@/lib/logger'

export const redis = new Redis({
    host: 'localhost',
    port: 6379
})

redis.on('connect', () => logger.info('Redis conectado'))
redis.on('error', (err: unknown) => {
    if (err instanceof Error) {
        console.error('Erro no Redis:', err.message)
        if (err.stack) console.error(err.stack)
    } else {
        console.error('Erro no Redis:', err)
    }
})
