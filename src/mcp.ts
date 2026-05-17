#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod/v4"
import { deterministicPlan, executePlan, planTvRequest, type PlannerMode } from "./ai"
import { getAiConfig } from "./config"
import { formatDevice, resolveDevice } from "./device"
import { findApp, launchApp, searchInApp } from "./roku/apps"
import { RokuClient } from "./roku/client"
import { discoverRokus } from "./roku/discover"
import { rokuKeys } from "./types"

const server = new McpServer({
  name: "tvctl",
  version: "0.2.0",
})

const hostSchema = z.string().optional().describe("Roku host/IP. Omit to use tvctl's configured default device.")

server.registerTool(
  "tvctl_discover",
  {
    title: "Discover Roku TVs",
    description: "Find Roku devices on the local network and return their names, hosts, and model details.",
    inputSchema: {
      timeoutMs: z.number().int().positive().max(15_000).optional().describe("Discovery timeout in milliseconds."),
    },
  },
  async ({ timeoutMs }) => {
    const devices = await discoverRokus(timeoutMs)
    return textResult(devices.length ? devices.map(formatDevice).join("\n") : "No Roku devices found.")
  },
)

server.registerTool(
  "tvctl_active",
  {
    title: "Get Active Roku App",
    description: "Return the currently active Roku app.",
    inputSchema: {
      host: hostSchema,
    },
  },
  async ({ host }) => {
    const { device, client } = await clientFor(host)
    const app = await client.activeApp()
    return textResult(app ? `${device.name}: ${app.name} (${app.id})` : `${device.name}: no active app reported.`)
  },
)

server.registerTool(
  "tvctl_apps",
  {
    title: "List Roku Apps",
    description: "List installed Roku apps, including IDs that can be used with launch/search tools.",
    inputSchema: {
      host: hostSchema,
    },
  },
  async ({ host }) => {
    const { device, client } = await clientFor(host)
    const apps = await client.apps()
    return textResult(`${device.name}\n${apps.map((app) => `${app.id.padEnd(8)} ${app.name}`).join("\n")}`)
  },
)

server.registerTool(
  "tvctl_key",
  {
    title: "Press Roku Remote Key",
    description: "Send a Roku remote keypress, such as Up, Down, Left, Right, Select, Home, Back, Play, Search, VolumeUp, or VolumeMute.",
    inputSchema: {
      key: z.enum(rokuKeys).describe("Roku ECP key name."),
      host: hostSchema,
    },
  },
  async ({ key, host }) => {
    const { device, client } = await clientFor(host)
    await client.keypress(key)
    return textResult(`Sent ${key} to ${device.name}.`)
  },
)

server.registerTool(
  "tvctl_type",
  {
    title: "Type Text On Roku",
    description: "Type text into the currently focused Roku text field.",
    inputSchema: {
      text: z.string().min(1).describe("Text to type."),
      host: hostSchema,
    },
  },
  async ({ text, host }) => {
    const { device, client } = await clientFor(host)
    await client.typeText(text)
    return textResult(`Typed ${text.length} characters to ${device.name}.`)
  },
)

server.registerTool(
  "tvctl_launch",
  {
    title: "Launch Roku App",
    description: "Launch an installed Roku app by ID or fuzzy name.",
    inputSchema: {
      app: z.string().min(1).describe("App ID or fuzzy app name, for example YouTube, Netflix, or Prime Video."),
      host: hostSchema,
    },
  },
  async ({ app, host }) => {
    const { device, client } = await clientFor(host)
    const apps = await client.apps()
    const launched = await launchApp(client, apps, app)
    return textResult(`Launched ${launched.name} on ${device.name}.`)
  },
)

server.registerTool(
  "tvctl_search",
  {
    title: "Search Roku",
    description: "Search Roku globally or within a named provider app using Roku ECP search.",
    inputSchema: {
      query: z.string().min(1).describe("Search query."),
      app: z.string().optional().describe("Optional provider app name or ID, such as YouTube or Prime Video."),
      host: hostSchema,
    },
  },
  async ({ query, app, host }) => {
    const { device, client } = await clientFor(host)
    const apps = await client.apps()
    if (app) {
      const provider = await searchInApp(client, apps, app, query)
      return textResult(`Searching ${provider.name} for "${query}" on ${device.name}.`)
    }

    await client.searchBrowse(query)
    return textResult(`Searching Roku for "${query}" on ${device.name}.`)
  },
)

server.registerTool(
  "tvctl_control",
  {
    title: "Control Roku From Request",
    description:
      "Plan and execute a concise TV-control request. In MCP clients, prefer primitive tools when possible; this tool is useful for simple natural-language requests.",
    inputSchema: {
      request: z.string().min(1).describe('Request such as "go home", "open YouTube", or "search Shrek on Prime".'),
      host: hostSchema,
      planner: z.enum(["local-only", "local-first", "ai-first", "auto"]).optional().describe("Planner mode. Defaults to local-only in MCP to avoid nested AI recursion."),
      dryRun: z.boolean().optional().describe("If true, return the planned actions without executing them."),
    },
  },
  async ({ request, host, planner, dryRun }) => {
    const { device, client } = await clientFor(host)
    const [apps, activeApp] = await Promise.all([client.apps(), client.activeApp().catch(() => undefined)])
    const mode = (planner ?? "local-only") as PlannerMode

    const result =
      mode === "local-only"
        ? { plan: mustPlanLocally(request, apps, activeApp), source: "local" as const }
        : await planTvRequest(request, apps, activeApp, await getAiConfig(), undefined, { mode })

    if (!dryRun) await executePlan(client, apps, result.plan)
    return textResult(`${dryRun ? "Planned" : "Done"} on ${device.name}: ${result.plan.summary} (${result.source})\n${JSON.stringify(result.plan.actions, null, 2)}`)
  },
)

async function clientFor(host?: string): Promise<{ device: Awaited<ReturnType<typeof resolveDevice>>; client: RokuClient }> {
  const device = await resolveDevice(host)
  return { device, client: new RokuClient(device.host) }
}

function mustPlanLocally(request: string, apps: Awaited<ReturnType<RokuClient["apps"]>>, activeApp: Awaited<ReturnType<RokuClient["activeApp"]>>) {
  const plan = deterministicPlan(request, apps, activeApp)
  if (!plan) {
    const appNames = apps.map((app) => app.name).join(", ")
    throw new Error(`Could not locally plan "${request}". Use primitive tvctl tools or planner=ai-first. Installed apps: ${appNames}`)
  }
  return plan
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}

export async function runMcpServer(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("tvctl MCP server running on stdio")
}

if (import.meta.main) {
  runMcpServer().catch((error) => {
    console.error("tvctl MCP server failed:", error)
    process.exit(1)
  })
}
