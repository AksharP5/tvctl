import { getDefaultDevice, setDefaultDevice } from "./config"
import { discoverRokus } from "./roku/discover"
import type { RokuDevice } from "./types"

export async function resolveDevice(host?: string): Promise<RokuDevice> {
  if (host) {
    return { id: host, host, name: `Roku ${host}` }
  }

  const configured = await getDefaultDevice()
  if (configured) return configured

  const devices = await discoverRokus()
  if (devices.length === 0) {
    throw new Error("No Roku devices found. Try `tvctl discover` or pass `--host <ip>`.")
  }

  const first = devices[0]
  if (!first) {
    throw new Error("No Roku devices found. Try `tvctl discover` or pass `--host <ip>`.")
  }

  await setDefaultDevice(first)
  return first
}

export function formatDevice(device: RokuDevice): string {
  const details = [device.model, device.serialNumber].filter(Boolean).join(" · ")
  return details ? `${device.name} (${device.host}) - ${details}` : `${device.name} (${device.host})`
}
