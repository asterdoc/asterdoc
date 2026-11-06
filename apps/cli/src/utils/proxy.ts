import { setGlobalProxyFromEnv } from 'node:http'

let initialized = false

export function initProxy(): void {
  if (initialized) return
  initialized = true

  if (!process.env.HTTPS_PROXY && !process.env.https_proxy && !process.env.HTTP_PROXY && !process.env.http_proxy) return

  setGlobalProxyFromEnv()
}
