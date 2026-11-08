const ACCESS_KEY = "access_token"

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(ACCESS_KEY)
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_KEY, token)
}

export function clearSession(): void {
  window.localStorage.removeItem(ACCESS_KEY)
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getServerId(): string | null {
  const token = getAccessToken()
  if (!token) return null
  const payload = decodePayload(token)
  return typeof payload?.server_id === "string" ? (payload.server_id as string) : null
}

export function getRole(): string | null {
  const token = getAccessToken()
  if (!token) return null
  const payload = decodePayload(token)
  return typeof payload?.role === "string" ? (payload.role as string) : null
}

export function isTokenExpired(): boolean {
  const token = getAccessToken()
  if (!token) return true
  const payload = decodePayload(token)
  const exp = payload?.exp
  return typeof exp !== "number" || exp * 1000 <= Date.now()
}

let refreshPromise: Promise<number> | null = null

export function refreshSession(): Promise<number> {
  if (refreshPromise) return refreshPromise
  refreshPromise = fetch("/api/auth/refresh", { method: "POST" })
    .then(async (res) => {
      if (!res.ok) return res.status
      const data = await res.json()
      if (typeof data.access_token === "string") {
        setAccessToken(data.access_token)
        return 200
      }
      return 401
    })
    .catch(() => 0) // 0 = network error (transient, don't clear session)
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

export async function ensureSession(): Promise<boolean> {
  if (getAccessToken() && !isTokenExpired()) return true
  return (await refreshSession()) === 200
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null) => {
    const headers = new Headers(options.headers)
    if (token) headers.set("Authorization", `Bearer ${token}`)
    return fetch(path, { ...options, headers })
  }

  let res = await doFetch(getAccessToken())
  if (res.status === 401) {
    const status = await refreshSession()
    if (status === 200) {
      res = await doFetch(getAccessToken())
    } else if (status === 401 || status === 400) {
      clearSession()
      if (typeof window !== "undefined") window.location.href = "/login"
    }
  }
  return res
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" })
  } catch {}
  clearSession()
}
