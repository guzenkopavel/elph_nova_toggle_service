import semver from 'semver'
import type { RuleRow } from '../rules/repository'
import type { RequestContext } from './types'

// Sentinel version values for null bounds
const VERSION_ZERO = '0.0.0'
const VERSION_MAX = '99999.0.0'

// Auth specificity: concrete audience = 2, 'all' = 1
function authScore(audience: RuleRow['audience']): number {
  return audience === 'all' ? 1 : 2
}

// Platform specificity: concrete platform = 2, 'all' = 1
function platformScore(platform: RuleRow['platform']): number {
  return platform === 'all' ? 1 : 2
}

// Version specificity: both bounds = 3, one bound = 2, no bounds = 1
function versionBoundCount(rule: RuleRow): number {
  const hasMin = rule.min_app_version !== null
  const hasMax = rule.max_app_version !== null
  if (hasMin && hasMax) return 3
  if (hasMin || hasMax) return 2
  return 1
}

// Range width as a numeric value in major.minor.patch units for tiebreaking.
// Smaller width = more specific. Returns Infinity when range is open-ended (null on both sides).
function rangeWidth(rule: RuleRow): number {
  const lo = semver.coerce(rule.min_app_version ?? VERSION_ZERO)
  const hi = semver.coerce(rule.max_app_version ?? VERSION_MAX)
  if (!lo || !hi) return Infinity
  // Use numeric representation: major*1e8 + minor*1e4 + patch
  const loNum = lo.major * 1e8 + lo.minor * 1e4 + lo.patch
  const hiNum = hi.major * 1e8 + hi.minor * 1e4 + hi.patch
  return hiNum - loNum
}

// Returns numeric specificity score (higher = more specific).
// score = authScore * 100 + platformScore * 10 + versionBoundCount
// Version range narrowness is a secondary comparator; not folded into the primary score.
export function computeSpecificity(rule: RuleRow): number {
  return authScore(rule.audience) * 100 + platformScore(rule.platform) * 10 + versionBoundCount(rule)
}

// Returns whether the rule's audience clause matches the request context.
function audienceMatches(rule: RuleRow, ctx: RequestContext): boolean {
  if (rule.audience === 'all') return true
  if (rule.audience === 'anonymous') return ctx.authState === 'anonymous'
  if (rule.audience === 'authenticated') return ctx.authState === 'authenticated'
  return false
}

// Returns whether the rule's platform clause matches the request context.
function platformMatches(rule: RuleRow, ctx: RequestContext): boolean {
  if (rule.platform === 'all') return true
  return rule.platform === ctx.platform
}

// Returns whether the rule's version range includes the request's appVersion.
// null min = 0.0.0, null max = 99999.0.0
function versionMatches(rule: RuleRow, appVersion: string): boolean {
  const v = semver.coerce(appVersion)
  if (!v) return false

  if (rule.min_app_version !== null) {
    const lo = semver.coerce(rule.min_app_version)
    if (!lo) return false
    if (semver.lt(v, lo)) return false
  }

  if (rule.max_app_version !== null) {
    const hi = semver.coerce(rule.max_app_version)
    if (!hi) return false
    if (semver.gt(v, hi)) return false
  }

  return true
}

// Returns whether this rule applies to the given request context.
export function ruleMatchesContext(rule: RuleRow, ctx: RequestContext): boolean {
  return audienceMatches(rule, ctx) && platformMatches(rule, ctx) && versionMatches(rule, ctx.appVersion)
}

// Returns the winning rule among all applicable rules, or null if none match.
// Tie-breaking: highest primary score wins; among equal-score rules, narrower range wins.
export function selectBestRule(rules: RuleRow[], ctx: RequestContext): RuleRow | null {
  const candidates = rules.filter((r) => ruleMatchesContext(r, ctx))
  if (candidates.length === 0) return null

  let best = candidates[0]!
  let bestScore = computeSpecificity(best)
  let bestWidth = rangeWidth(best)

  for (let i = 1; i < candidates.length; i++) {
    const r = candidates[i]!
    const score = computeSpecificity(r)
    const width = rangeWidth(r)
    if (score > bestScore) {
      best = r
      bestScore = score
      bestWidth = width
    } else if (score === bestScore && width < bestWidth) {
      best = r
      bestWidth = width
    }
  }

  return best
}

// Checks if two rules at the same specificity level have overlapping version ranges.
// Returns true if they overlap (ambiguous).
// Ranges [a_min, a_max] and [b_min, b_max] overlap if a_min <= b_max AND b_min <= a_max.
export function doRulesOverlap(a: RuleRow, b: RuleRow): boolean {
  const aLo = semver.coerce(a.min_app_version ?? VERSION_ZERO)
  const aHi = semver.coerce(a.max_app_version ?? VERSION_MAX)
  const bLo = semver.coerce(b.min_app_version ?? VERSION_ZERO)
  const bHi = semver.coerce(b.max_app_version ?? VERSION_MAX)

  if (!aLo || !aHi || !bLo || !bHi) return false

  // a_min <= b_max AND b_min <= a_max
  return semver.lte(aLo, bHi) && semver.lte(bLo, aHi)
}

// Given a set of rules for a single feature key, detects ambiguous overlapping rules.
// Two rules are ambiguous when they have the same (audience, platform) combination
// and their version ranges overlap.
// Returns array of conflicting pairs (empty = no ambiguity).
export function detectAmbiguousOverlap(rules: RuleRow[]): Array<[RuleRow, RuleRow]> {
  const conflicts: Array<[RuleRow, RuleRow]> = []

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!
      const b = rules[j]!

      // Only check rules at the same (audience, platform) level
      if (a.audience !== b.audience || a.platform !== b.platform) continue

      if (doRulesOverlap(a, b)) {
        conflicts.push([a, b])
      }
    }
  }

  return conflicts
}
