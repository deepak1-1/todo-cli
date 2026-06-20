// ============================================================
// Dependency resolver — pure logic for cycle detection
// ============================================================

/** Check for cycles using DFS in an adjacency list */
export function hasCycle(
    edges: { from: number; to: number }[],
): boolean {
    const adj = new Map<number, number[]>();
    const nodes = new Set<number>();

    for (const { from, to } of edges) {
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from)!.push(to);
        nodes.add(from);
        nodes.add(to);
    }

    const visited = new Set<number>();
    const inStack = new Set<number>();

    function dfs(node: number): boolean {
        visited.add(node);
        inStack.add(node);

        for (const neighbor of adj.get(node) || []) {
            if (!visited.has(neighbor)) {
                if (dfs(neighbor)) return true;
            } else if (inStack.has(neighbor)) {
                return true;
            }
        }

        inStack.delete(node);
        return false;
    }

    for (const node of nodes) {
        if (!visited.has(node)) {
            if (dfs(node)) return true;
        }
    }

    return false;
}

/** Topological sort (returns null if cycle exists) */
export function topologicalSort(
    edges: { from: number; to: number }[],
): number[] | null {
    const adj = new Map<number, number[]>();
    const inDegree = new Map<number, number>();
    const nodes = new Set<number>();

    for (const { from, to } of edges) {
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from)!.push(to);
        nodes.add(from);
        nodes.add(to);
        inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }

    const queue: number[] = [];
    for (const node of nodes) {
        if (!inDegree.has(node) || inDegree.get(node) === 0) {
            queue.push(node);
        }
    }

    const result: number[] = [];
    while (queue.length > 0) {
        const node = queue.shift()!;
        result.push(node);

        for (const neighbor of adj.get(node) || []) {
            const newDeg = (inDegree.get(neighbor) || 0) - 1;
            inDegree.set(neighbor, newDeg);
            if (newDeg === 0) queue.push(neighbor);
        }
    }

    return result.length === nodes.size ? result : null; // null = cycle
}
