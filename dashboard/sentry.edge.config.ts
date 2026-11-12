import * as Sentry from "@sentry/nextjs"

// Siehe sentry.server.config.ts: eigene Auth-Header vor dem Versand entfernen.
const SECRET_HEADERS = /^(authorization|cookie|x-api-key|x-sync-code|x-mod-attest)$/i

function scrubHeaders(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const headers = event.request?.headers
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SECRET_HEADERS.test(key)) headers[key] = "[redacted]"
    }
  }
  return event
}

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? "",
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV ?? "development",
  enabled: !!process.env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeSend: scrubHeaders,
})
