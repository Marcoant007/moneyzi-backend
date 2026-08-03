export class PeriodUtils {
    static parseMonthRange(period: string): { start: Date; end: Date } {
        const [yearRaw, monthRaw] = period.split('-')
        const year = Number(yearRaw)
        const monthIndex = Number(monthRaw) - 1

        const start = new Date(year, monthIndex, 1)
        const end = new Date(year, monthIndex + 1, 1)

        return { start, end }
    }

    static shiftPeriod(period: string, deltaMonths: number): string {
        const [yearRaw, monthRaw] = period.split('-')
        const year = Number(yearRaw)
        const monthIndex = Number(monthRaw) - 1

        const shifted = new Date(year, monthIndex + deltaMonths, 1)
        const shiftedYear = shifted.getFullYear()
        const shiftedMonth = String(shifted.getMonth() + 1).padStart(2, '0')

        return `${shiftedYear}-${shiftedMonth}`
    }

    static lastNPeriods(period: string, n: number): string[] {
        return Array.from({ length: n }, (_, index) => this.shiftPeriod(period, -(index + 1)))
    }
}
