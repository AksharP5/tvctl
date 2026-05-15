#!/usr/bin/env bun
import { cac } from "cac"
import { getConfigPath, setDefaultDevice } from "./config"
import { formatDevice, resolveDevice } from "./device"
import { runDoctor } from "./doctor"
import { RokuClient } from "./roku/client"
import { discoverRokus } from "./roku/discover"
import { runRemote } from "./tui/remote"
import type { RokuApp, RokuKey } from "./types"

const cli = cac("tvctl")

interface HostOptions {
  host?: string
}

cli
  .command("", "Open the Roku terminal remote")
  .option("--host <host>", "Roku host or IP address")
  .action(async (options: HostOptions) => {
    const device = await resolveDevice(options.host)
    await runRemote(device)
  })

cli
  .command("remote", "Open the Roku terminal remote")
  .option("--host <host>", "Roku host or IP address")
  .action(async (options: HostOptions) => {
    const device = await resolveDevice(options.host)
    await runRemote(device)
  })

cli.command("discover", "Find Roku devices on the local network").action(async () => {
  const devices = await discoverRokus()
  if (devices.length === 0) {
    console.log("No Roku devices found.")
    return
  }

  await setDefaultDevice(devices[0]!)
  for (const device of devices) {
    console.log(formatDevice(device))
  }
  console.log(`\nDefault device saved to ${getConfigPath()}`)
})

cli
  .command("doctor", "Diagnose Roku discovery and network control")
  .option("--host <host>", "Roku host or IP address to test directly")
  .action(async (options: HostOptions) => {
    await runDoctor(options.host)
  })

cli
  .command("key <key>", "Send a Roku keypress")
  .option("--host <host>", "Roku host or IP address")
  .action(async (key: RokuKey, options: HostOptions) => {
    const device = await resolveDevice(options.host)
    await new RokuClient(device.host).keypress(key)
    console.log(`Sent ${key} to ${device.name}`)
  })

cli
  .command("type <text>", "Type text into the active Roku text field")
  .option("--host <host>", "Roku host or IP address")
  .action(async (text: string, options: HostOptions) => {
    const device = await resolveDevice(options.host)
    await new RokuClient(device.host).typeText(text)
    console.log(`Typed ${text.length} characters to ${device.name}`)
  })

cli
  .command("apps", "List installed Roku apps")
  .option("--host <host>", "Roku host or IP address")
  .action(async (options: HostOptions) => {
    const device = await resolveDevice(options.host)
    const apps = await new RokuClient(device.host).apps()
    for (const app of apps) {
      console.log(`${app.id.padEnd(8)} ${app.name}`)
    }
  })

cli
  .command("launch <query>", "Launch a Roku app by id or fuzzy name")
  .option("--host <host>", "Roku host or IP address")
  .action(async (query: string, options: HostOptions) => {
    const device = await resolveDevice(options.host)
    const client = new RokuClient(device.host)
    const apps = await client.apps()
    const app = apps.find((candidate) => candidate.id === query) ?? fuzzyFindApp(apps, query)

    if (!app) {
      throw new Error(`No Roku app matched "${query}". Run \`tvctl apps\` to see installed apps.`)
    }

    await client.launch(app.id)
    console.log(`Launched ${app.name} on ${device.name}`)
  })

cli
  .command("active", "Print the active Roku app")
  .option("--host <host>", "Roku host or IP address")
  .action(async (options: HostOptions) => {
    const device = await resolveDevice(options.host)
    const app = await new RokuClient(device.host).activeApp()
    console.log(app ? `${app.name} (${app.id})` : "No active app reported.")
  })

cli.help()
cli.version("0.1.0")

try {
  cli.parse()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

function fuzzyFindApp(apps: RokuApp[], query: string): RokuApp | undefined {
  const normalized = normalize(query)
  return apps.find((app) => normalize(app.name) === normalized) ?? apps.find((app) => normalize(app.name).includes(normalized))
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}
