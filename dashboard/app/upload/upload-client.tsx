"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"

const MAX_IMAGES = 3
const MAX_EDGE = 1920
const JPEG_QUALITY = 0.85
const CODE_PATTERN = /^[A-Za-z0-9]{8}$/
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"]

type CodeStatus = {
  image_count: number
  remaining: number
  expires_at: string
}

type PendingFile = {
  id: string
  name: string
  blob: Blob
  previewUrl: string
  size: number
}

type Result = { name: string; ok: boolean; message: string }

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas")

    // JPEG kennt keine Transparenz — auf Weiß flachlegen.
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    )
    if (!blob) throw new Error("encode")
    return blob
  } finally {
    bitmap.close()
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function UploadClient() {
  const params = useSearchParams()
  const initialCode = (params.get("c") ?? "").trim().toUpperCase()

  const [code, setCode] = useState(CODE_PATTERN.test(initialCode) ? initialCode : "")
  const [codeInput, setCodeInput] = useState(CODE_PATTERN.test(initialCode) ? "" : initialCode)
  const [status, setStatus] = useState<CodeStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [codeError, setCodeError] = useState("")

  const [files, setFiles] = useState<PendingFile[]>([])
  const [fileError, setFileError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<PendingFile[]>([])

  const remaining = status ? status.remaining : MAX_IMAGES

  const loadStatus = useCallback(async (value: string) => {
    setStatusLoading(true)
    setCodeError("")
    try {
      const res = await fetch(`/api/bug-report/image?c=${encodeURIComponent(value)}`, { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.valid) {
        setStatus({
          image_count: Number(data.image_count ?? 0),
          remaining: Number(data.remaining ?? 0),
          expires_at: String(data.expires_at ?? ""),
        })
        return
      }
      setStatus(null)
      if (res.status === 410) setCodeError("Dieser Upload-Code ist abgelaufen. Bitte erstelle im Spiel eine neue /bug-Meldung.")
      else if (res.status === 429) setCodeError("Zu viele Anfragen — bitte warte eine Minute.")
      else if (res.status === 404) setCodeError("Dieser Upload-Code ist ungültig. Prüfe den Code aus der /bug-Meldung.")
      else setCodeError(data?.error ?? "Der Code konnte nicht geprüft werden.")
    } catch {
      setStatus(null)
      setCodeError("Keine Verbindung zum Dashboard. Bitte später erneut versuchen.")
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!CODE_PATTERN.test(code)) return
    void loadStatus(code)
  }, [code, loadStatus])

  useEffect(() => {
    filesRef.current = files
  }, [files])

  useEffect(() => () => {
    filesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl))
  }, [])

  const usedSlots = status ? status.image_count : 0

  const submitCode = () => {
    const value = codeInput.trim().toUpperCase()
    if (!CODE_PATTERN.test(value)) {
      setCodeError("Der Code besteht aus 8 Buchstaben/Ziffern.")
      return
    }
    setCode("")
    setCodeInput("")
    // Kleiner Umweg, damit der Effect auch bei identischem Code erneut lädt.
    setTimeout(() => setCode(value), 0)
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setFileError("")
    const free = Math.max(remaining - files.length, 0)
    if (free === 0) {
      setFileError(`Maximal ${MAX_IMAGES} Bilder pro Meldung.`)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    const chosen = Array.from(list).slice(0, free)
    if (list.length > free) {
      setFileError(`Es passen nur noch ${free} Bild(er) dazu (max. ${MAX_IMAGES} pro Meldung).`)
    }

    const next: PendingFile[] = []
    for (const file of chosen) {
      if (!ACCEPTED.includes(file.type)) {
        setFileError("Nur PNG, JPEG oder WebP.")
        continue
      }
      try {
        const blob = await downscale(file)
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          blob,
          previewUrl: URL.createObjectURL(blob),
          size: blob.size,
        })
      } catch {
        setFileError(`"${file.name}" konnte nicht verarbeitet werden.`)
      }
    }
    if (next.length > 0) setFiles((prev) => [...prev, ...next])
    if (inputRef.current) inputRef.current.value = ""
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const target = prev.find((file) => file.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((file) => file.id !== id)
    })
  }

  async function uploadAll() {
    if (files.length === 0 || !status || uploading) return
    setUploading(true)
    setFileError("")

    const queued = [...files]
    const done: Result[] = []
    let remainingSlots = status.remaining
    let uploaded = status.image_count

    for (const file of queued) {
      if (remainingSlots <= 0) {
        done.push({ name: file.name, ok: false, message: `Maximal ${MAX_IMAGES} Bilder pro Meldung.` })
        continue
      }
      try {
        const res = await fetch(`/api/bug-report/image?c=${encodeURIComponent(code)}`, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: file.blob,
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.ok) {
          uploaded = Number(data.count ?? uploaded + 1)
          remainingSlots = Number(data.remaining ?? Math.max(MAX_IMAGES - uploaded, 0))
          done.push({ name: file.name, ok: true, message: `gesendet (${uploaded}/${MAX_IMAGES})` })
          removeFile(file.id)
        } else {
          const message = data?.error
            ?? (res.status === 429 ? "Zu viele Uploads — bitte kurz warten." : `Fehlgeschlagen (HTTP ${res.status}).`)
          done.push({ name: file.name, ok: false, message })
          if (res.status === 410) {
            remainingSlots = 0
            setStatus(null)
            setCodeError("Dieser Upload-Code ist abgelaufen. Bitte erstelle im Spiel eine neue /bug-Meldung.")
          }
        }
      } catch {
        done.push({ name: file.name, ok: false, message: "Keine Verbindung zum Dashboard." })
      }
      setResults((prev) => [...prev, done[done.length - 1]])
    }

    setStatus((prev) => prev ? { ...prev, image_count: uploaded, remaining: Math.max(remainingSlots, 0) } : prev)
    setUploading(false)
  }

  const expiryLabel = useMemo(() => {
    if (!status?.expires_at) return ""
    const date = new Date(status.expires_at)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  }, [status])

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Status Player · Bug-Meldung</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>
          Bilder anhängen
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
          Lade bis zu {MAX_IMAGES} Screenshots zu deiner /bug-Meldung hoch. Der Code steht in der Meldung im Spiel.
        </p>
      </div>

      {!code ? (
        <div className="card">
          <label className="label" htmlFor="upload-code">Upload-Code</label>
          <div className="flex gap-2 flex-col sm:flex-row">
            <input
              id="upload-code"
              className="input uppercase tracking-[0.2em]"
              value={codeInput}
              maxLength={8}
              placeholder="z. B. K7M2QP4X"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") submitCode() }}
            />
            <button className="btn-primary shrink-0" onClick={submitCode}>Weiter</button>
          </div>
          {codeError && (
            <p className="text-sm mt-3" style={{ color: "var(--red)" }}>{codeError}</p>
          )}
          <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
            Du hast keine Meldung? Nutze im Spiel <span className="font-mono">/bug &lt;Beschreibung&gt;</span>.
          </p>
        </div>
      ) : statusLoading && !status ? (
        <div className="card"><div className="skeleton h-40" /></div>
      ) : !status ? (
        <div className="card">
          <p className="text-sm" style={{ color: "var(--red)" }}>
            {codeError || "Dieser Upload-Code ist nicht gültig."}
          </p>
          <button
            className="btn-secondary mt-4"
            onClick={() => { setCode(""); setCodeInput(""); setCodeError("") }}
          >
            Anderen Code eingeben
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card !p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge-green">Code gültig</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                {usedSlots}/{MAX_IMAGES} Bild(er){expiryLabel ? ` · gültig bis ${expiryLabel} Uhr` : ""}
              </span>
              <button
                className="ml-auto text-xs hover:opacity-80"
                style={{ color: "var(--text-secondary)" }}
                onClick={() => { setStatus(null); setCode(""); setCodeInput(""); setResults([]); setCodeError("") }}
              >
                Anderer Code
              </button>
            </div>
            {remaining === 0 && (
              <p className="text-xs mt-3" style={{ color: "var(--amber)" }}>
                Alle {MAX_IMAGES} Bild-Plätze sind belegt.
              </p>
            )}
            {codeError && <p className="text-sm mt-3" style={{ color: "var(--red)" }}>{codeError}</p>}
          </div>

          {remaining > 0 && (
            <div className="card">
              <label className="label" htmlFor="bug-images">Screenshots auswählen</label>
              <input
                id="bug-images"
                ref={inputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                multiple
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-semibold file:cursor-pointer"
                style={{ color: "var(--text-muted)" }}
                onChange={(e) => { void addFiles(e.target.files) }}
              />
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                Bilder werden im Browser auf max. 1920 px verkleinert und als JPEG hochgeladen.
              </p>
              {fileError && <p className="text-sm mt-2" style={{ color: "var(--red)" }}>{fileError}</p>}
            </div>
          )}

          {files.length > 0 && (
            <div className="card">
              <div className="kicker mb-3">Bereit zum Hochladen</div>
              <div className="grid grid-cols-3 gap-3">
                {files.map((file) => (
                  <div key={file.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className="w-full h-24 object-cover rounded-lg border"
                      style={{ borderColor: "var(--border)" }}
                    />
                    <button
                      onClick={() => removeFile(file.id)}
                      className="absolute top-1 right-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono"
                      style={{ backgroundColor: "var(--bg-card)", color: "var(--red)", border: "1px solid var(--red-line)" }}
                      aria-label={`${file.name} entfernen`}
                    >
                      ✕
                    </button>
                    <div className="text-[10px] font-mono mt-1 truncate" style={{ color: "var(--text-muted)" }} title={file.name}>
                      {formatSize(file.size)}
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn-primary mt-4 w-full" onClick={() => { void uploadAll() }} disabled={uploading}>
                {uploading ? "Wird hochgeladen …" : `${files.length} Bild(er) hochladen`}
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="card">
              <div className="kicker mb-3">Ergebnis</div>
              <ul className="space-y-2">
                {results.map((result, index) => (
                  <li key={`${result.name}-${index}`} className="text-sm font-mono flex gap-2" style={{ color: result.ok ? "var(--accent-text)" : "var(--red)" }}>
                    <span>{result.ok ? "✓" : "✕"}</span>
                    <span className="truncate">{result.name}</span>
                    <span className="ml-auto shrink-0" style={{ color: "var(--text-muted)" }}>{result.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status && remaining === 0 && results.some((r) => r.ok) && (
            <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
              Fertig — die Bilder sind beim Admin angekommen.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
