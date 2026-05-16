#!/usr/bin/env bun
import { cac } from "cac"
import { deterministicPlan, executePlan, planWithOpenCode } from "./ai"
import { getConfigPath, setDefaultDevice } from "./config"
import { formatDevice, resolveDevice } from "./device"
import { findApp, launchApp, searchInApp } from "./roku/apps"
import { RokuClient } from "./roku/client"
import { discoverRokus } from "./roku/discover"
import { runRemote } from "./tui/remote"
import type { RokuKey } from "./types"

const cli = cac("tvctl")
const knownCommands = new Set(["remote", "discover", "key", "type", "apps", "launch", "active", "ask", "help"])

interface HostOptions {
  host?: string
}

await maybeRunAppShortcut()

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
  .command("ask [...prompt]", "Ask tvctl to control the TV in plain English")
  .option("--host <host>", "Roku host or IP address")
  .action(async (prompt: string[], options: HostOptions) => {
    const request = prompt.join(" ").trim()
    if (!request) throw new Error('Usage: tvctl ask "open YouTube and search Drake album"')
    await runAiRequest(request, options.host)
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
    const app = await launchApp(client, apps, query)
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

async function maybeRunAppShortcut(): Promise<void> {
  const args = process.argv.slice(2)
  const firstArg = args[0]
  if (!firstArg || firstArg.startsWith("-") || knownCommands.has(firstArg)) return

  const hostFlagIndex = args.indexOf("--host")
  const host = hostFlagIndex >= 0 ? args[hostFlagIndex + 1] : undefined
  const cleanArgs = hostFlagIndex >= 0 ? args.toSpliced(hostFlagIndex, 2) : args
  const [appQuery, action, ...terms] = cleanArgs
  if (!appQuery) return

  const device = await resolveDevice(host)
  const client = new RokuClient(device.host)
  const apps = await client.apps()
  const app = findApp(apps, appQuery)
  if (!app) {
    await runAiRequest(cleanArgs.join(" "), host)
    process.exit(0)
  }

  if (action === "search") {
    const query = terms.join(" ").trim()
    if (!query) throw new Error(`Usage: tvctl ${appQuery} search <query>`)
    await searchInApp(client, apps, appQuery, query)
    console.log(`Searching ${app.name} for "${query}" on ${device.name}`)
    process.exit(0)
  }

  await client.launch(app.id)
  console.log(`Launched ${app.name} on ${device.name}`)
  process.exit(0)
}

async function runAiRequest(request: string, host?: string): Promise<void> {
  const device = await resolveDevice(host)
  const client = new RokuClient(device.host)
  const apps = await client.apps()
  let plan = deterministicPlan(request, apps)
  if (!plan) {
    try {
      plan = await planWithOpenCode(request, apps)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not plan that TV request with AI: ${message}`)
    }
  }

  console.log(plan.summary)
  await executePlan(client, apps, plan)
  console.log(`Done on ${device.name}`)
}
