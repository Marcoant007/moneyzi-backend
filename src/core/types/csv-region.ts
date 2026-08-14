export type CsvRegion = 'BR' | 'US'

export const DEFAULT_CSV_REGION: CsvRegion = 'BR'

export function normalizeCsvRegion(value: unknown): CsvRegion {
    return value === 'US' ? 'US' : DEFAULT_CSV_REGION
}
