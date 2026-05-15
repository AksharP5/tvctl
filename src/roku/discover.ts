import dgram from "node:dgram"
import { URL } from "node:url"
import { RokuClient } from "./client"
import type { RokuDevice } from "../types"

const ssdpAddress = "239.255.255.250"
const ssdpPort = 1900

export async function discoverRokus(timeoutMs = 2500): Promise<RokuDevice[]> {
  const locations = await discoverLocations(timeoutMs)
  const devices: Array<RokuDevice | undefined> = await Promise.all(
    [...locations].map(async (location) => {
      try {
        const host = new URL(location).hostname
        const device = await new RokuClient(host).deviceInfo()
        return { ...device, location }
      } catch {
        return undefined
      }
    }),
  )

  const seen = new Set<string>()
  return devices.filter((device): device is RokuDevice => {
    if (!device || seen.has(device.host)) return false
    seen.add(device.host)
    return true
  })
}

async function discoverLocations(timeoutMs: number): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4")
    const locations = new Set<string>()
    const message = [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${ssdpAddress}:${ssdpPort}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: roku:ecp",
      "",
      "",
    ].join("\r\n")

    const timer = setTimeout(() => {
      socket.close()
      resolve(locations)
    }, timeoutMs)

    socket.on("message", (buffer) => {
      const response = buffer.toString("utf8")
      const location = findHeader(response, "location")
      if (location) locations.add(location)
    })

    socket.on("error", (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })

    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(message, ssdpPort, ssdpAddress)
    })
  })
}

function findHeader(response: string, name: string): string | undefined {
  const prefix = `${name.toLowerCase()}:`
  for (const line of response.split(/\r?\n/)) {
    const normalized = line.toLowerCase()
    if (normalized.startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }
  return undefined
}
