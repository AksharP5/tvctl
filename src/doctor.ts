import { RokuClient } from "./roku/client"
import { discoverRokuLocations, getPrivateIpv4Addresses } from "./roku/discover"

export async function runDoctor(host?: string): Promise<void> {
  console.log("tvctl doctor")
  console.log("")

  const addresses = getPrivateIpv4Addresses()
  console.log("Local private IPv4 addresses:")
  if (addresses.length === 0) {
    console.log("  none found")
  } else {
    for (const address of addresses) console.log(`  ${address}`)
  }

  console.log("")
  console.log("SSDP discovery:")
  const result = await discoverRokuLocations(3000)
  console.log(`  responses: ${result.responses.length}`)
  console.log(`  Roku locations: ${result.locations.size}`)
  for (const location of result.locations) console.log(`  ${location}`)

  if (host) {
    console.log("")
    console.log(`Direct ECP check for ${host}:`)
    const client = new RokuClient(host)
    try {
      const device = await client.deviceInfo()
      console.log(`  reachable: yes`)
      console.log(`  name: ${device.name}`)
      console.log(`  model: ${device.model ?? "unknown"}`)
      console.log(`  serial: ${device.serialNumber ?? "unknown"}`)
    } catch (error) {
      console.log("  reachable: no")
      console.log(`  error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log("")
  console.log("If no Roku is discovered:")
  console.log("  1. On the Roku: Settings > System > Advanced system settings > Control by mobile apps > Network access.")
  console.log("  2. Set Network access to Enabled. Use Permissive only if your LAN uses non-private IP ranges.")
  console.log("  3. Make sure your Mac and Roku are on the same non-guest Wi-Fi/LAN.")
  console.log("  4. Disable client/AP isolation on the router, or allow SSDP UDP 1900 and TCP 8060 between devices.")
  console.log("  5. Find the Roku IP at Settings > Network > About, then try `tvctl doctor --host <ip>`.")
}
