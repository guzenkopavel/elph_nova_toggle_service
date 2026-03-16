export interface EdgeSpec {
  parent_feature_key: string
  child_feature_key: string
}

/**
 * Returns true if adding (proposedParent → proposedChild) to existingEdges would create a cycle.
 * Uses DFS from proposedChild: if we can reach proposedParent, a cycle would be formed.
 */
export function wouldCreateCycle(existingEdges: EdgeSpec[], proposedParent: string, proposedChild: string): boolean {
  if (proposedParent === proposedChild) return true

  // Build adjacency: parent → children
  const children = new Map<string, Set<string>>()
  for (const edge of existingEdges) {
    if (!children.has(edge.parent_feature_key)) {
      children.set(edge.parent_feature_key, new Set())
    }
    children.get(edge.parent_feature_key)!.add(edge.child_feature_key)
  }

  // DFS from proposedChild: if we can reach proposedParent, cycle detected
  const visited = new Set<string>()
  const stack = [proposedChild]

  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === proposedParent) return true
    if (visited.has(node)) continue
    visited.add(node)
    const desc = children.get(node)
    if (desc) {
      for (const child of desc) stack.push(child)
    }
  }

  return false
}
