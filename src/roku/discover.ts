import dgram from "node:dgram"
import { networkInterfaces } from "node:os"
import { URL } from "node:url"
import { RokuClient } from "./client"
import type { RokuDevice } from "../types"

const ssdpAddress = "239.255.255.250"
const ssdpPort = 1900

export async function discoverRokus(timeoutMs = 2500): Promise<RokuDevice[]> {
  const result = await discoverRokuLocations(timeoutMs)
  const locations = result.locations
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

export interface RokuDiscoveryResult {
  locations: Set<string>
  responses: string[]
}

export async function discoverRokuLocations(timeoutMs = 2500): Promise<RokuDiscoveryResult> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4")
    const locations = new Set<string>()
    const responses: string[] = []
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
      resolve({ locations, responses })
    }, timeoutMs)

    socket.on("message", (buffer) => {
      const response = buffer.toString("utf8")
      responses.push(response)
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

export function getPrivateIpv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}

function isPrivateIpv4(address: string): boolean {
  return address.startsWith("10.") || address.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
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
