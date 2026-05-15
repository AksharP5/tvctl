import type { RokuApp, RokuDevice, RokuKey } from "../types"
import { parseActiveApp, parseApps, parseDeviceInfo } from "./xml"

export class RokuClient {
  readonly host: string
  readonly baseUrl: string

  constructor(host: string) {
    this.host = host.replace(/^https?:\/\//, "").replace(/\/$/, "")
    this.baseUrl = `http://${this.host}:8060`
  }

  async keypress(key: RokuKey): Promise<void> {
    await this.post(`/keypress/${key}`)
  }

  async typeText(text: string): Promise<void> {
    for (const char of text) {
      await this.post(`/keypress/Lit_${encodeURIComponent(char)}`)
    }
  }

  async launch(appId: string): Promise<void> {
    await this.post(`/launch/${encodeURIComponent(appId)}`)
  }

  async apps(): Promise<RokuApp[]> {
    const xml = await this.getText("/query/apps")
    return parseApps(xml)
  }

  async activeApp(): Promise<RokuApp | undefined> {
    const xml = await this.getText("/query/active-app")
    return parseActiveApp(xml)
  }

  async deviceInfo(): Promise<RokuDevice> {
    const xml = await this.getText("/query/device-info")
    return parseDeviceInfo(xml, this.host)
  }

  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      await this.getText("/query/device-info", timeoutMs)
      return true
    } catch {
      return false
    }
  }

  private async getText(path: string, timeoutMs = 5000): Promise<string> {
    const signal = AbortSignal.timeout(timeoutMs)
    const response = await fetch(`${this.baseUrl}${path}`, { signal })
    if (!response.ok) {
      throw new Error(`Roku request failed: GET ${path} ${response.status}`)
    }
    return response.text()
  }

  private async post(path: string, timeoutMs = 5000): Promise<void> {
    const signal = AbortSignal.timeout(timeoutMs)
    const response = await fetch(`${this.baseUrl}${path}`, { method: "POST", signal })
    if (!response.ok) {
      throw new Error(`Roku request failed: POST ${path} ${response.status}`)
    }
  }
}
