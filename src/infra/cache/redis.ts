import Redis from 'ioredis'

export const redis = new Redis({
    host: 'localhost',
    port: 6379
})

redis.on('connect', () => console.log('✅ Redis conectado'))
redis.on('error', (err) => console.error('❌ Erro no Redis:', err))
