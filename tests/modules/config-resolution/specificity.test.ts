import { describe, it, expect } from 'vitest'
import type { RuleRow } from '../../../src/modules/rules/repository'
import type { RequestContext } from '../../../src/modules/config-resolution/types'
import {
  ruleMatchesContext,
  computeSpecificity,
  selectBestRule,
  doRulesOverlap,
  detectAmbiguousOverlap,
} from '../../../src/modules/config-resolution/specificity'

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: 1,
    product_id: 1,
    feature_key: 'chat',
    audience: 'all',
    platform: 'all',
    min_app_version: null,
    max_app_version: null,
    entry_json: '{"isEnabled":true}',
    is_active: true,
    created_by: null,
    updated_by: 'test',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    authState: 'anonymous',
    platform: 'ios',
    appVersion: '2.0.0',
    ...overrides,
  }
}

// ─── Audience matching (UNIT-AUD) ─────────────────────────────────────────────

describe('ruleMatchesContext — audience', () => {
  it('UNIT-AUD-1: audience=all matches anonymous request', () => {
    expect(ruleMatchesContext(rule({ audience: 'all' }), ctx({ authState: 'anonymous' }))).toBe(true)
  })

  it('UNIT-AUD-2: audience=all matches authenticated request', () => {
    expect(ruleMatchesContext(rule({ audience: 'all' }), ctx({ authState: 'authenticated' }))).toBe(true)
  })

  it('UNIT-AUD-3: audience=anonymous matches anonymous only', () => {
    expect(ruleMatchesContext(rule({ audience: 'anonymous' }), ctx({ authState: 'anonymous' }))).toBe(true)
    expect(ruleMatchesContext(rule({ audience: 'anonymous' }), ctx({ authState: 'authenticated' }))).toBe(false)
  })

  it('UNIT-AUD-4: audience=authenticated matches authenticated only', () => {
    expect(ruleMatchesContext(rule({ audience: 'authenticated' }), ctx({ authState: 'authenticated' }))).toBe(true)
    expect(ruleMatchesContext(rule({ audience: 'authenticated' }), ctx({ authState: 'anonymous' }))).toBe(false)
  })

  it('UNIT-AUD-5: authenticated rule does not match anonymous context', () => {
    const r = rule({ audience: 'authenticated', platform: 'all', min_app_version: null, max_app_version: null })
    expect(ruleMatchesContext(r, ctx({ authState: 'anonymous' }))).toBe(false)
  })
})

// ─── Platform matching (UNIT-PLT) ─────────────────────────────────────────────

describe('ruleMatchesContext — platform', () => {
  it('UNIT-PLT-1: platform=all matches any platform', () => {
    expect(ruleMatchesContext(rule({ platform: 'all' }), ctx({ platform: 'ios' }))).toBe(true)
    expect(ruleMatchesContext(rule({ platform: 'all' }), ctx({ platform: 'android' }))).toBe(true)
    expect(ruleMatchesContext(rule({ platform: 'all' }), ctx({ platform: 'web' }))).toBe(true)
  })

  it('UNIT-PLT-2: platform=ios matches ios only', () => {
    expect(ruleMatchesContext(rule({ platform: 'ios' }), ctx({ platform: 'ios' }))).toBe(true)
    expect(ruleMatchesContext(rule({ platform: 'ios' }), ctx({ platform: 'android' }))).toBe(false)
    expect(ruleMatchesContext(rule({ platform: 'ios' }), ctx({ platform: 'web' }))).toBe(false)
  })

  it('UNIT-PLT-3: platform=android matches android only', () => {
    expect(ruleMatchesContext(rule({ platform: 'android' }), ctx({ platform: 'android' }))).toBe(true)
    expect(ruleMatchesContext(rule({ platform: 'android' }), ctx({ platform: 'ios' }))).toBe(false)
  })
})

// ─── Version matching (UNIT-VER) ──────────────────────────────────────────────

describe('ruleMatchesContext — version', () => {
  it('UNIT-VER-1: no bounds matches any version', () => {
    expect(ruleMatchesContext(rule({ min_app_version: null, max_app_version: null }), ctx({ appVersion: '1.0.0' }))).toBe(true)
    expect(ruleMatchesContext(rule({ min_app_version: null, max_app_version: null }), ctx({ appVersion: '99.0.0' }))).toBe(true)
  })

  it('UNIT-VER-2: min bound inclusive — exactly at min matches', () => {
    const r = rule({ min_app_version: '2.0.0', max_app_version: null })
    expect(ruleMatchesContext(r, ctx({ appVersion: '2.0.0' }))).toBe(true)
    expect(ruleMatchesContext(r, ctx({ appVersion: '1.9.9' }))).toBe(false)
    expect(ruleMatchesContext(r, ctx({ appVersion: '3.0.0' }))).toBe(true)
  })

  it('UNIT-VER-3: max bound inclusive — exactly at max matches', () => {
    const r = rule({ min_app_version: null, max_app_version: '3.0.0' })
    expect(ruleMatchesContext(r, ctx({ appVersion: '3.0.0' }))).toBe(true)
    expect(ruleMatchesContext(r, ctx({ appVersion: '3.0.1' }))).toBe(false)
    expect(ruleMatchesContext(r, ctx({ appVersion: '1.0.0' }))).toBe(true)
  })

  it('UNIT-VER-4: both bounds — version within range matches', () => {
    const r = rule({ min_app_version: '2.0.0', max_app_version: '4.0.0' })
    expect(ruleMatchesContext(r, ctx({ appVersion: '2.0.0' }))).toBe(true)
    expect(ruleMatchesContext(r, ctx({ appVersion: '3.0.0' }))).toBe(true)
    expect(ruleMatchesContext(r, ctx({ appVersion: '4.0.0' }))).toBe(true)
    expect(ruleMatchesContext(r, ctx({ appVersion: '1.9.9' }))).toBe(false)
    expect(ruleMatchesContext(r, ctx({ appVersion: '4.0.1' }))).toBe(false)
  })

  it('UNIT-VER-5: version below min does not match', () => {
    const r = rule({ min_app_version: '5.0.0', max_app_version: null })
    expect(ruleMatchesContext(r, ctx({ appVersion: '4.9.9' }))).toBe(false)
  })
})

// ─── Specificity scoring (UNIT-SPEC) ──────────────────────────────────────────

describe('computeSpecificity', () => {
  it('UNIT-SPEC-1: authenticated+concrete platform+both bounds scores highest', () => {
    const high = rule({ audience: 'authenticated', platform: 'ios', min_app_version: '1.0.0', max_app_version: '5.0.0' })
    const low = rule({ audience: 'all', platform: 'all', min_app_version: null, max_app_version: null })
    expect(computeSpecificity(high)).toBeGreaterThan(computeSpecificity(low))
  })

  it('UNIT-SPEC-2: auth dimension outranks platform dimension', () => {
    const authSpecific = rule({ audience: 'authenticated', platform: 'all', min_app_version: null, max_app_version: null })
    const platformSpecific = rule({ audience: 'all', platform: 'ios', min_app_version: null, max_app_version: null })
    expect(computeSpecificity(authSpecific)).toBeGreaterThan(computeSpecificity(platformSpecific))
  })

  it('UNIT-SPEC-3: platform dimension outranks version bound count', () => {
    const platformSpecific = rule({ audience: 'all', platform: 'ios', min_app_version: null, max_app_version: null })
    const versionSpecific = rule({ audience: 'all', platform: 'all', min_app_version: '1.0.0', max_app_version: '5.0.0' })
    expect(computeSpecificity(platformSpecific)).toBeGreaterThan(computeSpecificity(versionSpecific))
  })

  it('UNIT-SPEC-4: both bounds scores higher than one bound, one bound higher than none', () => {
    const both = rule({ min_app_version: '1.0.0', max_app_version: '5.0.0' })
    const one = rule({ min_app_version: '1.0.0', max_app_version: null })
    const none = rule({ min_app_version: null, max_app_version: null })
    expect(computeSpecificity(both)).toBeGreaterThan(computeSpecificity(one))
    expect(computeSpecificity(one)).toBeGreaterThan(computeSpecificity(none))
  })
})

// ─── selectBestRule (UNIT-SEL) ────────────────────────────────────────────────

describe('selectBestRule', () => {
  it('returns null when no rules provided', () => {
    expect(selectBestRule([], ctx())).toBeNull()
  })

  it('returns null when no rules match the context', () => {
    const r = rule({ audience: 'authenticated' })
    expect(selectBestRule([r], ctx({ authState: 'anonymous' }))).toBeNull()
  })

  it('returns the single matching rule', () => {
    const r = rule({ audience: 'all', platform: 'ios' })
    expect(selectBestRule([r], ctx({ platform: 'ios' }))).toEqual(r)
  })

  it('returns more specific rule over less specific', () => {
    const general = rule({ id: 1, audience: 'all', platform: 'all' })
    const specific = rule({ id: 2, audience: 'authenticated', platform: 'ios' })
    const result = selectBestRule([general, specific], ctx({ authState: 'authenticated', platform: 'ios' }))
    expect(result!.id).toBe(2)
  })

  it('tiebreaks by narrower version range when primary scores are equal', () => {
    const wide = rule({ id: 1, audience: 'all', platform: 'all', min_app_version: '1.0.0', max_app_version: '9.0.0' })
    const narrow = rule({ id: 2, audience: 'all', platform: 'all', min_app_version: '2.0.0', max_app_version: '3.0.0' })
    const result = selectBestRule([wide, narrow], ctx({ appVersion: '2.5.0' }))
    expect(result!.id).toBe(2)
  })
})

// ─── doRulesOverlap (UNIT-AMB) ────────────────────────────────────────────────

describe('doRulesOverlap', () => {
  it('UNIT-AMB-1: non-overlapping ranges do not conflict', () => {
    const a = rule({ min_app_version: '1.0.0', max_app_version: '2.0.0' })
    const b = rule({ min_app_version: '3.0.0', max_app_version: '4.0.0' })
    expect(doRulesOverlap(a, b)).toBe(false)
  })

  it('UNIT-AMB-2: partially overlapping ranges conflict', () => {
    const a = rule({ min_app_version: '1.0.0', max_app_version: '3.0.0' })
    const b = rule({ min_app_version: '2.0.0', max_app_version: '4.0.0' })
    expect(doRulesOverlap(a, b)).toBe(true)
  })

  it('UNIT-AMB-3: touching boundary — ranges sharing a single version overlap', () => {
    const a = rule({ min_app_version: '1.0.0', max_app_version: '3.0.0' })
    const b = rule({ min_app_version: '3.0.0', max_app_version: '5.0.0' })
    // 3.0.0 is in both ranges — they share that version
    expect(doRulesOverlap(a, b)).toBe(true)
  })

  it('UNIT-AMB-4: unbounded rules overlap each other', () => {
    const a = rule({ min_app_version: null, max_app_version: null })
    const b = rule({ min_app_version: null, max_app_version: null })
    expect(doRulesOverlap(a, b)).toBe(true)
  })
})

// ─── detectAmbiguousOverlap (UNIT-DEF) ────────────────────────────────────────

describe('detectAmbiguousOverlap', () => {
  it('UNIT-DEF-1: rules with different (audience, platform) are not ambiguous', () => {
    const a = rule({ id: 1, audience: 'all', platform: 'ios', min_app_version: '1.0.0', max_app_version: '3.0.0' })
    const b = rule({ id: 2, audience: 'authenticated', platform: 'ios', min_app_version: '2.0.0', max_app_version: '5.0.0' })
    expect(detectAmbiguousOverlap([a, b])).toHaveLength(0)
  })

  it('UNIT-DEF-2: two rules with same (audience, platform) and overlapping ranges are ambiguous', () => {
    const a = rule({ id: 1, audience: 'all', platform: 'ios', min_app_version: '1.0.0', max_app_version: '3.0.0' })
    const b = rule({ id: 2, audience: 'all', platform: 'ios', min_app_version: '2.0.0', max_app_version: '5.0.0' })
    const conflicts = detectAmbiguousOverlap([a, b])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual([a, b])
  })

  it('returns empty array for no rules', () => {
    expect(detectAmbiguousOverlap([])).toHaveLength(0)
  })

  it('returns empty array for a single rule', () => {
    expect(detectAmbiguousOverlap([rule()])).toHaveLength(0)
  })

  it('detects multiple conflicting pairs', () => {
    const a = rule({ id: 1, audience: 'all', platform: 'all', min_app_version: '1.0.0', max_app_version: '5.0.0' })
    const b = rule({ id: 2, audience: 'all', platform: 'all', min_app_version: '3.0.0', max_app_version: '7.0.0' })
    const c = rule({ id: 3, audience: 'all', platform: 'all', min_app_version: '4.0.0', max_app_version: '9.0.0' })
    // a overlaps b, a overlaps c, b overlaps c
    const conflicts = detectAmbiguousOverlap([a, b, c])
    expect(conflicts).toHaveLength(3)
  })

  it('non-overlapping ranges with same (audience, platform) are not ambiguous', () => {
    const a = rule({ id: 1, audience: 'authenticated', platform: 'android', min_app_version: '1.0.0', max_app_version: '2.0.0' })
    const b = rule({ id: 2, audience: 'authenticated', platform: 'android', min_app_version: '3.0.0', max_app_version: '5.0.0' })
    expect(detectAmbiguousOverlap([a, b])).toHaveLength(0)
  })
})
