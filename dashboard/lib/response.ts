import { NextResponse } from "next/server"

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 })
}

export function badRequest(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function unauthorized(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function conflict(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 409 })
}

export function tooMany(message = "Ungültige Anfrage") {
  return NextResponse.json({ error: message }, { status: 429 })
}

export function serverError(message = "Interner Fehler") {
  return NextResponse.json({ error: message }, { status: 500 })
}

export function badGateway(message = "Fehler im externen Dienst") {
  return NextResponse.json({ error: message }, { status: 502 })
}

export function notFound(message = "Nicht gefunden") {
  return NextResponse.json({ error: message }, { status: 404 })
}
