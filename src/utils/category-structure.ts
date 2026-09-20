import { createHash } from 'node:crypto'
import { getCategoryDepth, getDescendantIds, type CategoryHierarchyNode } from '@/utils/category-hierarchy'

/**
 * Regras de estrutura da árvore de categorias (colisão de nome, ciclo,
 * profundidade, plano de merge). Tudo puro, sem I/O: recebe a lista flat de
 * categorias do usuário e devolve o veredito — quem chama é que lê/grava.
 * Complementa category-hierarchy.ts (matemática da árvore) com as validações
 * que as tools de reorganização do MCP precisam antes de qualquer escrita.
 */

export const MAX_CATEGORY_DEPTH = 3

export interface NamedCategoryNode extends CategoryHierarchyNode {
    name: string
}

/**
 * Existem categorias legadas com espaço no final ("Aluguel Base ",
 * "fundo de reserva ") — a comparação de nomes ignora caixa E espaços nas
 * pontas dos dois lados, senão "Aluguel Base" e "Aluguel Base " passariam
 * como nomes diferentes sob o mesmo pai.
 */
export function normalizeCategoryName(name: string): string {
    return name.trim().toLowerCase()
}

/** Altura da subárvore com raiz em `id`: 1 = folha, 2 = tem filhos, 3 = tem netos. */
export function getSubtreeHeight(categories: CategoryHierarchyNode[], id: string): number {
    const childrenByParent = new Map<string, string[]>()
    for (const category of categories) {
        if (category.parentId) {
            const siblings = childrenByParent.get(category.parentId) ?? []
            siblings.push(category.id)
            childrenByParent.set(category.parentId, siblings)
        }
    }

    // `visited` protege contra ciclo em dado corrompido (não deveria existir,
    // mas o custo é zero e evita recursão infinita).
    const visited = new Set<string>()
    function height(nodeId: string): number {
        if (visited.has(nodeId)) return 0
        visited.add(nodeId)

        let deepestChild = 0
        for (const childId of childrenByParent.get(nodeId) ?? []) {
            deepestChild = Math.max(deepestChild, height(childId))
        }
        return 1 + deepestChild
    }

    return height(id)
}

/** Irmã (mesmo pai) com o mesmo nome normalizado, ignorando os ids em `ignoreIds`. */
export function findSiblingNameCollision<T extends NamedCategoryNode>(
    categories: T[],
    parentId: string | null,
    name: string,
    ignoreIds: string[] = [],
): T | undefined {
    const wanted = normalizeCategoryName(name)

    return categories.find(
        (category) =>
            (category.parentId ?? null) === parentId &&
            !ignoreIds.includes(category.id) &&
            normalizeCategoryName(category.name) === wanted,
    )
}

function labelOf(category: NamedCategoryNode): string {
    return `"${category.name.trim()}" (${category.id})`
}

// ---------------------------------------------------------------------------
// move_category
// ---------------------------------------------------------------------------

export interface MovePlan<T extends NamedCategoryNode = NamedCategoryNode> {
    category: T
    newParent: T | null
    /** true quando a categoria já está sob esse pai — nada a fazer. */
    isNoop: boolean
}

/**
 * Valida mover `categoryId` pra baixo de `newParentId` (null = virar raiz):
 * existência, ciclo, profundidade contando TODA a subárvore movida e colisão
 * de nome sob o novo pai. Lança em qualquer violação.
 */
export function planMove<T extends NamedCategoryNode>(
    categories: T[],
    categoryId: string,
    newParentId: string | null,
): MovePlan<T> {
    const category = categories.find((c) => c.id === categoryId)
    if (!category) {
        throw new Error('Categoria não encontrada')
    }

    const currentParentId = category.parentId ?? null
    if (currentParentId === newParentId) {
        return { category, newParent: null, isNoop: true }
    }

    let newParent: T | null = null
    if (newParentId !== null) {
        if (newParentId === categoryId) {
            throw new Error('CYCLE: uma categoria não pode ser sua própria categoria pai.')
        }

        newParent = categories.find((c) => c.id === newParentId) ?? null
        if (!newParent) {
            throw new Error('Categoria pai não encontrada')
        }

        if (getDescendantIds(categories, categoryId).has(newParentId)) {
            throw new Error(
                `CYCLE: não é possível mover ${labelOf(category)} para dentro de ${labelOf(newParent)}, que é uma de suas próprias subcategorias.`,
            )
        }
    }

    const newDepth = newParent ? getCategoryDepth(categories, newParent.id) + 1 : 1
    const deepestAfterMove = newDepth + getSubtreeHeight(categories, categoryId) - 1
    if (deepestAfterMove > MAX_CATEGORY_DEPTH) {
        throw new Error(
            `MAX_DEPTH_EXCEEDED: depois de mover ${labelOf(category)} a árvore chegaria a ${deepestAfterMove} níveis (máximo ${MAX_CATEGORY_DEPTH}), contando as subcategorias dela.`,
        )
    }

    const collision = findSiblingNameCollision(categories, newParentId, category.name, [categoryId])
    if (collision) {
        throw new Error(
            `NAME_COLLISION: já existe ${labelOf(collision)} sob o novo pai. Renomeie uma das duas (rename_category) ou junte-as (merge_categories) antes de mover.`,
        )
    }

    return { category, newParent, isNoop: false }
}

// ---------------------------------------------------------------------------
// merge_categories
// ---------------------------------------------------------------------------

export interface MergeConflict {
    /** Nome (sem espaços nas pontas) que as duas subcategorias disputam. */
    name: string
    sourceChild: { id: string; name: string }
    targetChild: { id: string; name: string }
    /**
     * true quando a "filha do destino" que colide é a própria origem (a origem está
     * sob o destino e uma filha dela tem o mesmo nome dela). A origem só é apagada
     * DEPOIS de reapontar as filhas, então nesse instante o banco veria dois irmãos
     * com o mesmo nome sob o destino.
     */
    targetChildIsSource?: true
}

export interface MergeDepthViolation {
    id: string
    name: string
    resultingDepth: number
}

export interface MergePlan<T extends NamedCategoryNode = NamedCategoryNode> {
    source: T
    target: T
    /** Filhas diretas da origem — as que serão reapontadas pro destino (as netas vão junto). */
    childrenToReparent: T[]
    conflicts: MergeConflict[]
    depthViolations: MergeDepthViolation[]
}

/**
 * Valida e descreve o merge de `sourceId` em `targetId`. Lança nas violações
 * "duras" (mesma categoria, inexistente, destino dentro da origem). Conflitos
 * de nome e estouro de profundidade voltam como dados no plano — quem chama
 * decide como expor (o dry-run lista; a execução falha).
 */
export function planMerge<T extends NamedCategoryNode>(categories: T[], sourceId: string, targetId: string): MergePlan<T> {
    if (sourceId === targetId) {
        throw new Error('SAME_CATEGORY: sourceId e targetId são a mesma categoria.')
    }

    const source = categories.find((c) => c.id === sourceId)
    if (!source) {
        throw new Error('Categoria de origem não encontrada')
    }

    const target = categories.find((c) => c.id === targetId)
    if (!target) {
        throw new Error('Categoria de destino não encontrada')
    }

    if (getDescendantIds(categories, sourceId).has(targetId)) {
        throw new Error(
            `CYCLE: o destino ${labelOf(target)} é descendente da origem ${labelOf(source)} — mesclar criaria um ciclo. Mova o destino pra fora da origem (move_category) antes.`,
        )
    }

    const childrenToReparent = categories.filter((c) => c.parentId === sourceId)

    // A origem NÃO sai do caminho mesmo quando é filha do destino: o merge reaponta
    // as filhas ANTES de apagar a origem (o FK é ON DELETE SET NULL, apagar antes
    // orfanaria tudo), então durante o reapontamento ela ainda existe como irmã.
    const targetChildren = categories.filter((c) => c.parentId === targetId)

    const conflicts: MergeConflict[] = []
    for (const child of childrenToReparent) {
        const clash = findSiblingNameCollision(targetChildren, targetId, child.name)
        if (clash) {
            conflicts.push({
                name: child.name.trim(),
                sourceChild: { id: child.id, name: child.name },
                targetChild: { id: clash.id, name: clash.name },
                ...(clash.id === sourceId ? { targetChildIsSource: true as const } : {}),
            })
        }
    }

    // A filha passa a ficar em depth(destino)+1; o ponto mais fundo da
    // subárvore dela fica em depth(destino) + altura da subárvore.
    const targetDepth = getCategoryDepth(categories, targetId)
    const depthViolations: MergeDepthViolation[] = []
    for (const child of childrenToReparent) {
        const resultingDepth = targetDepth + getSubtreeHeight(categories, child.id)
        if (resultingDepth > MAX_CATEGORY_DEPTH) {
            depthViolations.push({ id: child.id, name: child.name, resultingDepth })
        }
    }

    return { source, target, childrenToReparent, conflicts, depthViolations }
}

export function describeMergeConflicts(conflicts: MergeConflict[]): string {
    return conflicts
        .map((c) => {
            const note = c.targetChildIsSource ? ' — a própria origem, que está sob o destino; renomeie a subcategoria ou a origem' : ''
            return `"${c.name}" (origem ${c.sourceChild.id} × destino ${c.targetChild.id}${note})`
        })
        .join('; ')
}

export function describeDepthViolations(violations: MergeDepthViolation[]): string {
    return violations
        .map((v) => `"${v.name.trim()}" (${v.id}) ficaria no nível ${v.resultingDepth}`)
        .join('; ')
}

/**
 * Impressão digital do "conjunto afetado" de um merge: ids das transações que
 * serão movidas + ids das subcategorias que serão reapontadas. É o que o
 * confirmationToken amarra — se qualquer id entrar ou sair entre o dry-run e a
 * execução, o hash muda e o token é rejeitado.
 */
export function computeMergeFingerprint(input: { transactionIds: string[]; childIds: string[] }): string {
    const canonical = JSON.stringify({
        transactionIds: [...input.transactionIds].sort(),
        childIds: [...input.childIds].sort(),
    })
    return createHash('sha256').update(canonical).digest('hex')
}
