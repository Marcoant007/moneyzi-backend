import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const options: pino.LoggerOptions = isDev
    ? {
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' }
        }
    }
    : {}

const logger = pino(options)

export default logger
