export type AppLocale = 'pt' | 'en'

export const DEFAULT_LOCALE: AppLocale = 'pt'

export function normalizeLocale(value: unknown): AppLocale {
    return value === 'en' ? 'en' : DEFAULT_LOCALE
}
