import { ok, serverError, unauthorized, forbidden, badRequest, notFound } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { authorizeData, requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

// Mod-Build-Spur + Dev-Build-Freigabe eines Servers.
//
// Die Werte kommen aus dem Build-Attest, das der Mod bei jedem Sync mitschickt
// (siehe lib/attest.ts und die Sync-Route). Hier wird nur gelesen und - vom
// Owner - der Testschalter `allow_dev_builds` gesetzt.

export const dynamic = "force-dynamic"

const BuildSettingsSchema = z.object({
  allow_dev_builds: z.boolean(),
})

const BUILD_SELECT = "attest_build_id, attest_key_id, attest_verified_at, allow_dev_builds"

function readBuild(row: Record<string, unknown>) {
  return {
    attest_build_id: (row.attest_build_id as string | null) ?? null,
    attest_key_id: (row.attest_key_id as string | null) ?? null,
    attest_verified_at: (row.attest_verified_at as string | null) ?? null,
    allow_dev_builds: row.allow_dev_builds === true,
  }
}

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const authed = await authorizeData(request, "check", params.server_id)
  if (!authed) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("servers")
    .select(BUILD_SELECT)
    .eq("id", params.server_id)
    .maybeSingle()

  if (error) return serverError()
  if (!data) return notFound()
  return ok(readBuild(data))
}

export async function PUT(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann Dev-Builds freigeben")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = BuildSettingsSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const { data: server, error: findError } = await (sb as any)
    .from("servers")
    .select("id")
    .eq("id", params.server_id)
    .maybeSingle()

  if (findError) return serverError()
  if (!server) return notFound()

  const { error } = await (sb as any)
    .from("servers")
    .update({ allow_dev_builds: parsed.data.allow_dev_builds })
    .eq("id", params.server_id)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "build_settings",
    who_uuid: session.sub,
    details: parsed.data,
  })

  return ok({ allow_dev_builds: parsed.data.allow_dev_builds })
}
