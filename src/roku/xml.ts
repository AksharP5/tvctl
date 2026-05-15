import { XMLParser } from "fast-xml-parser"
import type { RokuApp, RokuDevice } from "../types"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "name",
  trimValues: true,
})

export function parseApps(xml: string): RokuApp[] {
  const parsed = parser.parse(xml) as {
    apps?: { app?: Array<Record<string, unknown>> | Record<string, unknown> }
  }

  const apps = parsed.apps?.app
  const list = Array.isArray(apps) ? apps : apps ? [apps] : []

  return list
    .map((app) => ({
      id: String(app.id ?? ""),
      name: String(app.name ?? ""),
      type: app.type ? String(app.type) : undefined,
      version: app.version ? String(app.version) : undefined,
    }))
    .filter((app) => app.id && app.name)
}

export function parseActiveApp(xml: string): RokuApp | undefined {
  const parsed = parser.parse(xml) as {
    "active-app"?: { app?: Record<string, unknown> }
  }

  const app = parsed["active-app"]?.app
  if (!app?.id || !app.name) return undefined

  return {
    id: String(app.id),
    name: String(app.name),
    type: app.type ? String(app.type) : undefined,
    version: app.version ? String(app.version) : undefined,
  }
}

export function parseDeviceInfo(xml: string, host: string): RokuDevice {
  const parsed = parser.parse(xml) as {
    "device-info"?: Record<string, unknown>
  }
  const info = parsed["device-info"] ?? {}
  const userName = String(info["user-device-name"] ?? "").trim()
  const friendlyName = String(info["friendly-device-name"] ?? "").trim()
  const model = String(info["model-name"] ?? info["model-number"] ?? "").trim()
  const serialNumber = String(info["serial-number"] ?? "").trim()
  const id = serialNumber || host

  return {
    id,
    host,
    name: userName || friendlyName || model || `Roku ${host}`,
    model: model || undefined,
    serialNumber: serialNumber || undefined,
  }
}
