import { createHash, timingSafeEqual } from 'crypto'

/**
 * Compara segredos em tempo constante. Faz hash dos dois lados antes, para que
 * tamanhos diferentes não vazem pelo tempo de resposta nem lancem exceção.
 * Valor ausente ou vazio nunca é igual a nada (fail-closed).
 */
export function safeEqual(provided: string | undefined | null, expected: string | undefined | null): boolean {
    if (!provided || !expected) return false
    const a = createHash('sha256').update(provided).digest()
    const b = createHash('sha256').update(expected).digest()
    return timingSafeEqual(a, b)
}
