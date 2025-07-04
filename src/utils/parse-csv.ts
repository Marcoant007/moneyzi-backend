import { ParsedTransaction } from '@/core/interface/transaction-interface'
import { parse } from 'csv-parse/sync'
import { mapHeaders } from './map-headers'
import { parseCsvRow } from './parse-csv-row'

export function parseCsv(buffer: Buffer): Partial<ParsedTransaction>[] {
    const content = buffer.toString('utf-8').replace(/^\uFEFF/, '')

    const rawRecords = parse(content, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true
    }) as Record<string, string>[]

    if (!rawRecords.length) return []

    const headerMap = mapHeaders(Object.keys(rawRecords[0]))

    return rawRecords.map((raw) => parseCsvRow(raw, headerMap))
}