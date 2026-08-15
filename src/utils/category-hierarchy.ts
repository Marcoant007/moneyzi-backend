export interface CategoryHierarchyNode {
    id: string
    parentId: string | null
}

export function getAncestorIds(categories: CategoryHierarchyNode[], id: string): string[] {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const ancestors: string[] = []
    let current = byId.get(id)

    // A profundidade máxima é 3, então isso nunca sobe mais de 2 níveis —
    // sem risco de loop infinito mesmo que dados corrompidos criem um ciclo.
    while (current?.parentId) {
        if (ancestors.includes(current.parentId)) break
        ancestors.push(current.parentId)
        current = byId.get(current.parentId)
    }

    return ancestors
}

export function getCategoryDepth(categories: CategoryHierarchyNode[], id: string): number {
    return getAncestorIds(categories, id).length + 1
}

export function getTopLevelAncestorId(categories: CategoryHierarchyNode[], id: string): string {
    const ancestors = getAncestorIds(categories, id)
    return ancestors.length > 0 ? ancestors[ancestors.length - 1] : id
}

export function buildTopLevelCategoryNameMap(
    categories: { id: string; parentId: string | null; name: string }[],
): Map<string, string> {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const map = new Map<string, string>()

    for (const category of categories) {
        const topId = getTopLevelAncestorId(categories, category.id)
        const top = byId.get(topId)
        map.set(category.id, top ? top.name : category.name)
    }

    return map
}

export function getDescendantIds(categories: CategoryHierarchyNode[], id: string): Set<string> {
    const childrenByParent = new Map<string, string[]>()
    for (const category of categories) {
        if (category.parentId) {
            const siblings = childrenByParent.get(category.parentId) ?? []
            siblings.push(category.id)
            childrenByParent.set(category.parentId, siblings)
        }
    }

    const result = new Set<string>()
    const stack = [...(childrenByParent.get(id) ?? [])]
    while (stack.length > 0) {
        const current = stack.pop() as string
        if (result.has(current)) continue
        result.add(current)
        const children = childrenByParent.get(current)
        if (children) stack.push(...children)
    }

    return result
}

export function rollupCategoryTotals(
    categories: CategoryHierarchyNode[],
    directTotals: Map<string, number>,
): Map<string, number> {
    const totals = new Map<string, number>()
    for (const category of categories) {
        totals.set(category.id, directTotals.get(category.id) ?? 0)
    }

    const byDepthDesc = [...categories].sort(
        (a, b) => getCategoryDepth(categories, b.id) - getCategoryDepth(categories, a.id),
    )

    for (const category of byDepthDesc) {
        if (category.parentId && totals.has(category.parentId)) {
            const ownTotal = totals.get(category.id) ?? 0
            const parentTotal = totals.get(category.parentId) ?? 0
            totals.set(category.parentId, parentTotal + ownTotal)
        }
    }

    return totals
}
