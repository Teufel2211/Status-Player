import * as Sentry from "@sentry/nextjs"

// Auth-Material darf nie im Crash-Report landen. Sentry filtert die
// Standard-Header (authorization, cookie) selbst - die eigenen Header
// (x-api-key, x-sync-code, x-mod-attest) nicht.
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
  beforeSendTransaction: (event) => {
    const headers = event.request?.headers
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SECRET_HEADERS.test(key)) headers[key] = "[redacted]"
      }
    }
    return event
  },
})
