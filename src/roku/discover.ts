import dgram from "node:dgram"
import { networkInterfaces } from "node:os"
import { URL } from "node:url"
import { RokuClient } from "./client"
import type { RokuDevice } from "../types"

const ssdpAddress = "239.255.255.250"
const ssdpPort = 1900

export async function discoverRokus(timeoutMs = 2500): Promise<RokuDevice[]> {
  const locations = await discoverLocations(timeoutMs)
  const ssdpDevices: Array<RokuDevice | undefined> = await Promise.all(
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
  const devices = ssdpDevices.some(Boolean) ? ssdpDevices : await scanLocalSubnets()

  const seen = new Set<string>()
  return devices.filter((device): device is RokuDevice => {
    if (!device || seen.has(device.host)) return false
    seen.add(device.host)
    return true
  })
}

async function scanLocalSubnets(): Promise<Array<RokuDevice | undefined>> {
  const hosts = getLocalSubnetHosts()
  const devices: Array<RokuDevice | undefined> = []
  const concurrency = 48

  for (let index = 0; index < hosts.length; index += concurrency) {
    const chunk = hosts.slice(index, index + concurrency)
    const found = await Promise.all(
      chunk.map(async (host) => {
        try {
          return await new RokuClient(host).deviceInfo(450)
        } catch {
          return undefined
        }
      }),
    )
    devices.push(...found)
  }

  return devices
}

function getLocalSubnetHosts(): string[] {
  const prefixes = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue
      if (!isPrivateIpv4(entry.address)) continue
      const parts = entry.address.split(".")
      if (parts.length !== 4) continue
      prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`)
    }
  }

  return [...prefixes].flatMap((prefix) => {
    return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`)
  })
}

function isPrivateIpv4(address: string): boolean {
  return address.startsWith("10.") || address.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
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
