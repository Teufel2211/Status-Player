import { createClient } from "@supabase/supabase-js"
import { getEnv } from "./env"

let _serviceClient: ReturnType<typeof createClient> | null = null

// Next.js (14) patcht das globale fetch und legt GET-Requests im "Data Cache"
// ab. Auf Vercel werden Route-Handler-Antworten daraus dauerhaft bedient -
// unabhängig von `dynamic = "force-dynamic"`. supabase-js ruft intern fetch
// auf, wodurch Query-Ergebnisse einfrieren konnten (Bug: gelöschte Meldungen
// tauchten im Posteingang wieder auf, im Dev-Modus nicht reproduzierbar).
// Explizites no-store schaltet den Cache für alle Supabase-Calls ab.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" })

export function getServiceClient() {
  if (_serviceClient) return _serviceClient
  const env = getEnv()
  _serviceClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  })
  return _serviceClient
}
