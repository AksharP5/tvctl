import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { RokuApp, RokuDevice, RokuKey } from "../types"
import { parseActiveApp, parseApps, parseDeviceInfo } from "./xml"

const execFileAsync = promisify(execFile)

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

  async apps(timeoutMs = 5000): Promise<RokuApp[]> {
    const xml = await this.getText("/query/apps", timeoutMs)
    return parseApps(xml)
  }

  async activeApp(timeoutMs = 5000): Promise<RokuApp | undefined> {
    const xml = await this.getText("/query/active-app", timeoutMs)
    return parseActiveApp(xml)
  }

  async deviceInfo(timeoutMs = 5000): Promise<RokuDevice> {
    const xml = await this.getText("/query/device-info", timeoutMs)
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
    return rokuRequest(this.host, path, "GET", timeoutMs)
  }

  private async post(path: string, timeoutMs = 5000): Promise<void> {
    await rokuRequest(this.host, path, "POST", timeoutMs)
  }
}

function rokuRequest(host: string, path: string, method: "GET" | "POST", timeoutMs: number): Promise<string> {
  const seconds = Math.max(0.2, timeoutMs / 1000).toFixed(2)
  const url = `http://${host}:8060${path}`
  const args = ["-fsS", "--max-time", String(seconds), "-A", "tvctl", "-X", method, url]

  return execFileAsync("curl", args, { maxBuffer: 1024 * 1024 }).then(
    ({ stdout }) => stdout,
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Roku request failed: ${method} ${path}: ${message}`)
    },
  )
}
