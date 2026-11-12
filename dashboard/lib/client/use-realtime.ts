"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { clearSession, getAccessToken, isTokenExpired, refreshSession } from "./auth"

type Player = {
  uuid: string
  username: string | null
  status: string | null
  color: string | null
  avatar: string | null
  updated_at: string | null
}

type ConnectionState = "connecting" | "connected" | "disconnected"

const MAX_BACKOFF_MS = 60_000
const BASE_BACKOFF_MS = 5_000

export function useRealtimePlayers() {
  const [players, setPlayers] = useState<Player[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  // true, sobald mindestens ein Snapshot empfangen wurde (der Server schickt ihn
  // jetzt direkt beim Verbindungsaufbau, danach alle 30 s).
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const failuresRef = useRef(0)

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (!mountedRef.current) return
    failuresRef.current += 1
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (failuresRef.current - 1), MAX_BACKOFF_MS)
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = setTimeout(connectFn, delay)
  }, [])

  const connect = useCallback(async () => {
    if (!mountedRef.current) return
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // Das Access-Token laeuft nach ~1 h ab. EventSource kann keine Header
    // senden, das Token steckt in der URL -> ohne Refresh scheitert jeder
    // Reconnect dauerhaft mit 401 und der Live-Feed kommt nie zurueck.
    if (!getAccessToken() || isTokenExpired()) {
      const status = await refreshSession()
      if (!mountedRef.current) return
      if (status === 401 || status === 400) {
        clearSession()
        setConnection("disconnected")
        if (typeof window !== "undefined") window.location.href = "/login"
        return
      }
      if (status !== 200) {
        // 429/5xx/Netzwerk = transient, kein Logout.
        setConnection("disconnected")
        scheduleReconnect(() => { void connect() })
        return
      }
    }

    const token = getAccessToken()
    if (!token) {
      setConnection("disconnected")
      return
    }

    setConnection("connecting")
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    eventSourceRef.current = es

    es.onopen = () => {
      if (!mountedRef.current) return
      failuresRef.current = 0
      setConnection("connected")
    }

    es.addEventListener("players", (e) => {
      try {
        const data = JSON.parse(e.data)
        if (mountedRef.current && Array.isArray(data)) {
          setPlayers(data)
          setHasSnapshot(true)
        }
      } catch {}
    })

    es.onerror = () => {
      if (!mountedRef.current) return
      setConnection("disconnected")
      es.close()
      if (eventSourceRef.current === es) eventSourceRef.current = null
      scheduleReconnect(() => { void connect() })
    }
  }, [scheduleReconnect])

  useEffect(() => {
    mountedRef.current = true
    void connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [connect])

  return { players, connection, hasSnapshot }
}
