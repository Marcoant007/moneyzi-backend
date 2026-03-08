export class MoneyUtils {
    static toCents(value: number): number {
        return Math.round((value + Number.EPSILON) * 100)
    }

    static fromCents(cents: number): number {
        return Number((cents / 100).toFixed(2))
    }

    static round(value: number): number {
        return this.fromCents(this.toCents(value))
    }

    static add(a: number, b: number): number {
        return this.fromCents(this.toCents(a) + this.toCents(b))
    }

    static subtract(a: number, b: number): number {
        return this.fromCents(this.toCents(a) - this.toCents(b))
    }

    static sum(values: number[]): number {
        const cents = values.reduce((acc, value) => acc + this.toCents(value), 0)
        return this.fromCents(cents)
    }

    static isZero(value: number): boolean {
        return this.toCents(value) === 0
    }
}
