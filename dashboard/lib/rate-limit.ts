const stores = new Map<string, { count: number; resetAt: number }>()
const MAX_STORE_ENTRIES = 10_000

function evictStores(now: number): void {
  if (stores.size < MAX_STORE_ENTRIES) return
  stores.forEach((v, k) => {
    if (now > v.resetAt) stores.delete(k)
  })
  if (stores.size < MAX_STORE_ENTRIES) return
  // Still full (active flood): drop oldest arbitrarily to bound memory.
  const first = stores.keys().next()
  if (!first.done) stores.delete(first.value)
}

export interface RateLimitConfig {
  windowMs: number
  max: number
}

export function checkRateLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetAt: number; max: number } {
  const now = Date.now()
  evictStores(now)
  const entry = stores.get(key)

  if (!entry || now > entry.resetAt) {
    stores.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs, max: config.max }
  }

  entry.count++
  if (entry.count > config.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, max: config.max }
  }

  return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt, max: config.max }
}

export function getRateLimitHeaders(result: { allowed: boolean; remaining: number; resetAt: number; max: number }) {
  return {
    "X-RateLimit-Limit": String(result.max),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  }
}

export const RATE_LIMITS = {
  LOGIN: { windowMs: 60_000, max: 3 },
  CODE_GENERATION: { windowMs: 60_000, max: 3 },
  TOTP_VERIFY: { windowMs: 60_000, max: 5 },
  BUG_REPORT: { windowMs: 600_000, max: 3 },
  BUG_IMAGE_STATUS: { windowMs: 60_000, max: 60 },
  BUG_IMAGE_UPLOAD_IP: { windowMs: 600_000, max: 20 },
  BUG_IMAGE_UPLOAD_CODE: { windowMs: 600_000, max: 12 },
} as const

const LOGIN_LOCKOUT = {
  maxFailures: 3,
  windowMs: 60_000,
  banMs: 300_000,
} as const

const failureStore = new Map<string, { count: number; firstAt: number }>()
const bannedStore = new Map<string, number>()
const MAX_FAILURE_ENTRIES = 10_000

function evictFailureStores(now: number): void {
  if (failureStore.size >= MAX_FAILURE_ENTRIES) {
    failureStore.forEach((v, k) => {
      if (now > v.firstAt + LOGIN_LOCKOUT.windowMs) failureStore.delete(k)
    })
    if (failureStore.size >= MAX_FAILURE_ENTRIES) {
      const first = failureStore.keys().next()
      if (!first.done) failureStore.delete(first.value)
    }
  }
  if (bannedStore.size >= MAX_FAILURE_ENTRIES) {
    bannedStore.forEach((until, k) => {
      if (now > until) bannedStore.delete(k)
    })
    if (bannedStore.size >= MAX_FAILURE_ENTRIES) {
      const first = bannedStore.keys().next()
      if (!first.done) bannedStore.delete(first.value)
    }
  }
}

export function isLockedOut(key: string): boolean {
  evictFailureStores(Date.now())
  const until = bannedStore.get(key)
  if (!until) return false
  if (Date.now() > until) {
    bannedStore.delete(key)
    return false
  }
  return true
}

export function lockoutRemainingMs(key: string): number {
  const until = bannedStore.get(key)
  if (!until) return 0
  const remaining = until - Date.now()
  if (remaining <= 0) {
    bannedStore.delete(key)
    return 0
  }
  return remaining
}

export function recordLoginFailure(key: string): void {
  const now = Date.now()
  evictFailureStores(now)
  const f = failureStore.get(key)
  if (!f || now > f.firstAt + LOGIN_LOCKOUT.windowMs) {
    failureStore.set(key, { count: 1, firstAt: now })
    return
  }
  f.count++
  if (f.count >= LOGIN_LOCKOUT.maxFailures) {
    bannedStore.set(key, now + LOGIN_LOCKOUT.banMs)
    failureStore.delete(key)
  }
}

export function clearLoginFailures(key: string): void {
  failureStore.delete(key)
  bannedStore.delete(key)
}
