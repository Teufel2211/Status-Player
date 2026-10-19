import type { Metadata } from "next"
import { Suspense } from "react"
import Footer from "@/components/footer"
import UploadClient from "./upload-client"

export const metadata: Metadata = {
  title: "Bug-Bilder anhängen — StatusMod",
  robots: { index: false, follow: false },
}

export default function UploadPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          <Suspense fallback={<div className="card"><div className="skeleton h-56" /></div>}>
            <UploadClient />
          </Suspense>
        </div>
      </main>
      <div className="pb-8 px-4">
        <Footer />
      </div>
    </div>
  )
}
