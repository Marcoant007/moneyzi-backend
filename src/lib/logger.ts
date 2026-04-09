import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

// Grafana Cloud Loki configuration
const grafanaLokiUrl = process.env.GRAFANA_LOKI_URL
const grafanaLokiUser = process.env.GRAFANA_LOKI_USER
const grafanaLokiApiKey = process.env.GRAFANA_LOKI_API_KEY

const hasGrafanaConfig = grafanaLokiUrl && grafanaLokiUser && grafanaLokiApiKey

const options: pino.LoggerOptions = isDev
    ? {
        // Development: pretty console logs
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' }
        }
    }
    : hasGrafanaConfig
        ? {
            // Production com Grafana Cloud: envia logs para Loki
            transport: {
                target: 'pino-loki',
                options: {
                    batching: true,
                    interval: 5,
                    host: grafanaLokiUrl,
                    basicAuth: {
                        username: grafanaLokiUser,
                        password: grafanaLokiApiKey
                    },
                    labels: {
                        app: 'moneyzi-backend',
                        env: process.env.NODE_ENV || 'production'
                    }
                }
            }
        }
        : {
            // Production sem Grafana: JSON simples no stdout
            level: 'info'
        }

const logger = pino(options)

export default logger
