import { ok, serverError, unauthorized, forbidden, badRequest, notFound } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { authorizeData, requireSession } from "@/lib/auth"
import { isFleetAdmin } from "@/lib/fleet-admin"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

// Mod-Build-Spur, Dev-Build-Freigabe und Release-Gate-Freigabe eines Servers.
//
// Die Attest-Werte kommen aus dem Build-Attest, das der Mod bei jedem Sync
// mitschickt (siehe lib/attest.ts und die Sync-Route). Hier wird nur gelesen,
// der Testschalter `allow_dev_builds` gesetzt (Server-Owner) und ein unbekannter
// Build freigegeben bzw. die Freigabe zurueckgezogen (nur Fleet-Admin).

export const dynamic = "force-dynamic"

const BuildSettingsSchema = z.union([
  z.object({ allow_dev_builds: z.boolean() }).strict(),
  z
    .object({
      build_override: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[0-9A-Za-z.\-]+$/)
        .nullable(),
    })
    .strict(),
])

const BUILD_SELECT =
  "attest_build_id, attest_key_id, attest_verified_at, allow_dev_builds, " +
  "build_check_status, build_check_build_id, build_check_at, build_override_id"

function readBuild(row: Record<string, unknown>) {
  return {
    attest_build_id: (row.attest_build_id as string | null) ?? null,
    attest_key_id: (row.attest_key_id as string | null) ?? null,
    attest_verified_at: (row.attest_verified_at as string | null) ?? null,
    allow_dev_builds: row.allow_dev_builds === true,
    build_check_status: (row.build_check_status as string | null) ?? null,
    build_check_build_id: (row.build_check_build_id as string | null) ?? null,
    build_check_at: (row.build_check_at as string | null) ?? null,
    build_override_id: (row.build_override_id as string | null) ?? null,
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

  // --- Dev-Builds: unveraendert Sache des Server-Owners -------------------
  if ("allow_dev_builds" in parsed.data) {
    if (session.server_id !== params.server_id) return unauthorized()
    if (session.role !== "owner") {
      return forbidden("Nur der Owner kann Dev-Builds freigeben")
    }

    const { error } = await (sb as any)
      .from("servers")
      .update({ allow_dev_builds: parsed.data.allow_dev_builds })
      .eq("id", params.server_id)

    if (error) return serverError()

    await writeAuditLog({
      server_id: params.server_id,
      action: "build_settings",
      who_uuid: session.sub,
      details: { allow_dev_builds: parsed.data.allow_dev_builds },
    })

    return ok({ allow_dev_builds: parsed.data.allow_dev_builds })
  }

  // --- Release-Gate-Freigabe: nur Fleet-Admin ------------------------------
  // Bewusst NICHT auf die eigene server_id beschraenkt: der Fleet-Admin
  // schaltet Builds auf allen Servern frei (er ist Owner des Projekts, nicht
  // zwingend Owner jedes einzelnen Servers).
  if (!(await isFleetAdmin(sb, session.sub))) {
    return forbidden("not_fleet_admin")
  }

  const override = parsed.data.build_override

  const { error } = await (sb as any)
    .from("servers")
    .update({ build_override_id: override })
    .eq("id", params.server_id)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: override ? "build_override_set" : "build_override_cleared",
    who_uuid: session.sub,
    details: { build_override_id: override },
  })

  return ok({ build_override_id: override })
}
