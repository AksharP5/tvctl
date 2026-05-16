import { execFile } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { findApp, launchApp } from "./roku/apps"
import { RokuClient } from "./roku/client"
import type { RokuApp, RokuKey, TvctlAiConfig } from "./types"

const execFileAsync = promisify(execFile)
export const defaultAiConfig = {
  provider: "opencode",
  model: "opencode/big-pickle",
} satisfies TvctlAiConfig

export type TvAction =
  | { action: "launch"; app: string }
  | { action: "key"; key: RokuKey }
  | { action: "type"; text: string }
  | { action: "wait"; ms: number }

export interface TvPlan {
  summary: string
  actions: TvAction[]
}

export async function planWithAi(request: string, apps: RokuApp[], config?: TvctlAiConfig, modelOverride?: string): Promise<TvPlan> {
  const provider = config?.provider ?? defaultAiConfig.provider
  const model = modelOverride ?? config?.model ?? process.env.TVCTL_AI_MODEL ?? defaultAiConfig.model

  if (provider === "opencode") {
    return planWithOpenCode(request, apps, model)
  }
  if (provider === "codex") {
    return planWithCodex(request, apps, model)
  }
  if (provider === "claude") {
    return planWithClaude(request, apps, model)
  }

  throw new Error(`Unsupported AI provider: ${provider}`)
}

export async function planWithOpenCode(request: string, apps: RokuApp[], model: string): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const { stdout } = await execFileAsync("opencode", ["run", "-m", model, prompt], {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  })
  return parsePlan(stdout)
}

export async function planWithCodex(request: string, apps: RokuApp[], model?: string): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const outputPath = join(tmpdir(), `tvctl-codex-plan-${Date.now()}.json`)
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-o", outputPath]
  if (model) args.push("-m", model)
  args.push(prompt)

  const { stdout } = await execFileAsync("codex", args, {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  })

  const outputFile = Bun.file(outputPath)
  const output = (await outputFile.exists()) ? await outputFile.text() : stdout
  return parsePlan(output)
}

export async function planWithClaude(request: string, apps: RokuApp[], model?: string): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const args = ["-p", prompt, "--output-format", "text"]
  if (model) args.push("--model", model)

  const { stdout } = await execFileAsync("claude", args, {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  })
  return parsePlan(stdout)
}

export async function executePlan(client: RokuClient, apps: RokuApp[], plan: TvPlan): Promise<void> {
  for (const action of plan.actions) {
    switch (action.action) {
      case "launch":
        await launchApp(client, apps, action.app)
        break
      case "key":
        await client.keypress(action.key)
        break
      case "type":
        await client.typeText(action.text)
        break
      case "wait":
        await sleep(action.ms)
        break
    }
  }
}

export function deterministicPlan(request: string, apps: RokuApp[]): TvPlan | undefined {
  const lower = request.toLowerCase()

  const searchMatch =
    lower.match(/^(?:open|launch|start)\s+(.+?)\s+(?:and\s+)?(?:search|find)(?:\s+for)?\s+(.+)$/) ??
    lower.match(/^(.+?)\s+(?:search|find)(?:\s+for)?\s+(.+)$/) ??
    lower.match(/^(?:search|find)(?:\s+for)?\s+(.+?)\s+(?:on|in)\s+(.+)$/)

  if (searchMatch?.[1] && searchMatch[2]) {
    const first = searchMatch[1].trim()
    const second = searchMatch[2].trim()
    const appQuery = lower.startsWith("search") || lower.startsWith("find") ? second : first
    const query = lower.startsWith("search") || lower.startsWith("find") ? first : second
    const app = findApp(apps, appQuery)
    if (!app) return undefined

    return {
      summary: `Search ${app.name} for "${query}"`,
      actions: [
        { action: "launch", app: app.name },
        { action: "wait", ms: 2500 },
        { action: "key", key: "Search" },
        { action: "wait", ms: 900 },
        { action: "type", text: query },
      ],
    }
  }

  const launchMatch = lower.match(/^(?:open|launch|start)\s+(.+)$/)
  if (launchMatch?.[1]) {
    const app = findApp(apps, launchMatch[1].trim())
    if (!app) return undefined
    return {
      summary: `Launch ${app.name}`,
      actions: [{ action: "launch", app: app.name }],
    }
  }

  const switchMatch = lower.match(/^(?:switch|change|go)\s+(?:to\s+)?(.+)$/)
  if (switchMatch?.[1]) {
    const app = findApp(apps, switchMatch[1].trim())
    if (!app) return undefined
    return {
      summary: `Launch ${app.name}`,
      actions: [{ action: "launch", app: app.name }],
    }
  }

  const keyPlan = planCommonRemoteKey(lower)
  if (keyPlan) return keyPlan

  return undefined
}

function buildPrompt(request: string, apps: RokuApp[]): string {
  const appList = apps.map((app) => `${app.name} (${app.id})`).join(", ")
  return [
    "Convert this Roku TV request into JSON actions. Return ONLY JSON.",
    'Schema: {"summary":"short summary","actions":[...]}',
    'Actions: {"action":"launch","app":"app name or id"} | {"action":"key","key":"Home|Back|Search|Select|Up|Down|Left|Right|Play|InstantReplay|Info|VolumeUp|VolumeDown|VolumeMute|PowerOff|PowerOn"} | {"action":"type","text":"text"} | {"action":"wait","ms":number}.',
    "For app search: launch app, wait 2500, key Search, wait 900, type query.",
    `Installed apps: ${appList}`,
    `User request: ${request}`,
  ].join("\n")
}

function planCommonRemoteKey(lower: string): TvPlan | undefined {
  const request = lower.trim()
  const keyMappings: Array<[RegExp, RokuKey, string]> = [
    [/\b(go\s+)?home\b/, "Home", "Go home"],
    [/\b(go\s+)?back\b/, "Back", "Go back"],
    [/\b(search|find)\b(?!.*\b(for|in|on)\b)/, "Search", "Open search"],
    [/\b(play|pause|resume|toggle playback)\b/, "Play", "Toggle playback"],
    [/\b(replay|instant replay)\b/, "InstantReplay", "Instant replay"],
    [/\b(info|details|options)\b/, "Info", "Open info"],
    [/\bvolume up\b/, "VolumeUp", "Volume up"],
    [/\bvolume down\b/, "VolumeDown", "Volume down"],
    [/\b(mute|unmute)\b/, "VolumeMute", "Toggle mute"],
    [/\b(power off|turn off)\b/, "PowerOff", "Power off TV"],
    [/\b(power on|turn on)\b/, "PowerOn", "Power on TV"],
  ]

  for (const [pattern, key, summary] of keyMappings) {
    if (pattern.test(request)) {
      return { summary, actions: [{ action: "key", key }] }
    }
  }

  return undefined
}

function parsePlan(output: string): TvPlan {
  const clean = stripAnsi(output)
  const jsonText = extractJson(clean)
  const parsed = JSON.parse(jsonText) as TvPlan
  if (!Array.isArray(parsed.actions)) {
    throw new Error("AI plan did not include actions.")
  }
  return parsed
}

function extractJson(output: string): string {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/)
  const source = fenced?.[1] ?? output
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI did not return a JSON plan.")
  }
  return source.slice(start, end + 1)
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
