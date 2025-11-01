export function getRequiredEnv(name: string): string {
    const v = process.env[name]
    if (!v || v.trim() === '') {
        throw new Error(`Environment variable ${name} is required`)
    }
    return v
}