import { NextResponse } from "next/server"

// API-Antworten sind grundsätzlich nicht cachebar (teils authentifiziert,
// teils live). no-store verhindert, dass Browser oder Vercel-Edge veraltete
// JSON-Antworten ausliefern.
const NO_STORE = { "Cache-Control": "no-store" }

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE })
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201, headers: NO_STORE })
}

export function badRequest(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE })
}

export function unauthorized(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 401, headers: NO_STORE })
}

export function forbidden(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 403, headers: NO_STORE })
}

export function conflict(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 409, headers: NO_STORE })
}

export function tooMany(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 429, headers: NO_STORE })
}

export function serverError(message = "Interner Fehler") {
  return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE })
}

export function badGateway(message = "Fehler im externen Dienst") {
  return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE })
}

export function notFound(message = "Nicht gefunden") {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE })
}

export function gone(message = "Nicht mehr verfügbar") {
  return NextResponse.json({ error: message }, { status: 410, headers: NO_STORE })
}

export function payloadTooLarge(message = "Datei zu groß") {
  return NextResponse.json({ error: message }, { status: 413, headers: NO_STORE })
}

export function unsupportedMediaType(message = "Dateityp nicht unterstützt") {
  return NextResponse.json({ error: message }, { status: 415, headers: NO_STORE })
}
