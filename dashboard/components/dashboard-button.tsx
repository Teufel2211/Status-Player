"use client"

import { useRouter } from "next/navigation"
import { ensureSession, getFleetAdmin } from "@/lib/client/auth"

// "Dashboard"-Knopf: leitet je nach Rechten weiter. Projekt-Admins
// (Admin-Dashboard) landen im Admin-Bereich, alle anderen im Dashboard
// ihres eigenen Servers. Ohne Session geht es zum Login.
export default function DashboardButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter()

  async function handleClick() {
    const ok = await ensureSession()
    if (!ok) {
      router.push("/login")
      return
    }
    router.push(getFleetAdmin() ? "/admin-dashboard" : "/dashboard")
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
