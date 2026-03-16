import { describe, it, expect } from 'vitest'
import { wouldCreateCycle } from '../../../src/modules/dependencies/cycle'

describe('wouldCreateCycle', () => {
  it('C1: returns true for self-dependency (A → A)', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true)
  })

  it('C2: returns false for empty graph (no existing edges)', () => {
    expect(wouldCreateCycle([], 'A', 'B')).toBe(false)
  })

  it('C3: returns true for direct cycle (A→B exists, proposed B→A)', () => {
    const edges = [{ parent_feature_key: 'A', child_feature_key: 'B' }]
    expect(wouldCreateCycle(edges, 'B', 'A')).toBe(true)
  })

  it('C4: returns false for valid DAG addition (A→B exists, proposed A→C)', () => {
    const edges = [{ parent_feature_key: 'A', child_feature_key: 'B' }]
    expect(wouldCreateCycle(edges, 'A', 'C')).toBe(false)
  })

  it('C5: returns true for transitive cycle (A→B, B→C exist, proposed C→A)', () => {
    const edges = [
      { parent_feature_key: 'A', child_feature_key: 'B' },
      { parent_feature_key: 'B', child_feature_key: 'C' },
    ]
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true)
  })

  it('C6: returns false for diamond shape (A→B, A→C, B→D exists, proposed C→D)', () => {
    const edges = [
      { parent_feature_key: 'A', child_feature_key: 'B' },
      { parent_feature_key: 'A', child_feature_key: 'C' },
      { parent_feature_key: 'B', child_feature_key: 'D' },
    ]
    expect(wouldCreateCycle(edges, 'C', 'D')).toBe(false)
  })

  it('C7: returns false for longer valid chain', () => {
    const edges = [
      { parent_feature_key: 'A', child_feature_key: 'B' },
      { parent_feature_key: 'B', child_feature_key: 'C' },
      { parent_feature_key: 'C', child_feature_key: 'D' },
    ]
    // Adding D→E is fine
    expect(wouldCreateCycle(edges, 'D', 'E')).toBe(false)
  })

  it('C8: returns true for deep transitive cycle', () => {
    const edges = [
      { parent_feature_key: 'A', child_feature_key: 'B' },
      { parent_feature_key: 'B', child_feature_key: 'C' },
      { parent_feature_key: 'C', child_feature_key: 'D' },
      { parent_feature_key: 'D', child_feature_key: 'E' },
    ]
    // Proposed E→A would create a cycle A→B→C→D→E→A
    expect(wouldCreateCycle(edges, 'E', 'A')).toBe(true)
  })
})
