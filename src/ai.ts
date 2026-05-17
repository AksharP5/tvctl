import { execFile } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { findApp, launchApp } from "./roku/apps"
import { RokuClient } from "./roku/client"
import type { RokuApp, RokuKey, TvctlAiConfig } from "./types"

const execFileAsync = promisify(execFile)
const aiTimeoutMs = Number(process.env.TVCTL_AI_TIMEOUT_MS ?? 180_000)
const aiPlannerBudgetMs = Number(process.env.TVCTL_AI_PLANNER_BUDGET_MS ?? 8_000)
interface AiRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export type PlannerMode = "auto" | "ai-first" | "local-first" | "local-only"

export const defaultAiConfig = {
  provider: "opencode",
  model: "opencode/big-pickle",
} satisfies TvctlAiConfig

export type TvAction =
  | { action: "launch"; app: string }
  | { action: "search"; query: string; app?: string; launch?: boolean }
  | { action: "key"; key: RokuKey }
  | { action: "type"; text: string }
  | { action: "wait"; ms: number }

export interface TvPlan {
  summary: string
  actions: TvAction[]
}

export async function planWithAi(
  request: string,
  apps: RokuApp[],
  config?: TvctlAiConfig,
  modelOverride?: string,
  options: AiRunOptions = {},
): Promise<TvPlan> {
  const provider = config?.provider ?? defaultAiConfig.provider
  const model = modelOverride ?? config?.model ?? process.env.TVCTL_AI_MODEL ?? defaultAiConfig.model

  if (provider === "opencode") {
    return planWithOpenCode(request, apps, model, options)
  }
  if (provider === "codex") {
    return planWithCodex(request, apps, model, options)
  }
  if (provider === "claude") {
    return planWithClaude(request, apps, model, options)
  }

  throw new Error(`Unsupported AI provider: ${provider}`)
}

export async function planWithOpenCode(request: string, apps: RokuApp[], model: string, options: AiRunOptions = {}): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const { stdout } = await execFileAsync("opencode", ["run", "-m", model, prompt], {
    timeout: options.timeoutMs ?? aiTimeoutMs,
    maxBuffer: 1024 * 1024,
    signal: options.signal,
  }).catch((error) => {
    throw providerError("OpenCode", error, options.timeoutMs)
  })
  return parsePlan(stdout)
}

export async function planWithCodex(request: string, apps: RokuApp[], model?: string, options: AiRunOptions = {}): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const outputPath = join(tmpdir(), `tvctl-codex-plan-${Date.now()}.json`)
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-o", outputPath]
  if (model) args.push("-m", model)
  args.push(prompt)

  const { stdout } = await execFileAsync("codex", args, {
    timeout: options.timeoutMs ?? aiTimeoutMs,
    maxBuffer: 1024 * 1024,
    signal: options.signal,
  }).catch((error) => {
    throw providerError("Codex", error, options.timeoutMs)
  })

  const outputFile = Bun.file(outputPath)
  const output = (await outputFile.exists()) ? await outputFile.text() : stdout
  return parsePlan(output)
}

export async function planWithClaude(request: string, apps: RokuApp[], model?: string, options: AiRunOptions = {}): Promise<TvPlan> {
  const prompt = buildPrompt(request, apps)
  const args = ["-p", prompt, "--output-format", "text"]
  if (model) args.push("--model", model)

  const { stdout } = await execFileAsync("claude", args, {
    timeout: options.timeoutMs ?? aiTimeoutMs,
    maxBuffer: 1024 * 1024,
    signal: options.signal,
  }).catch((error) => {
    throw providerError("Claude", error, options.timeoutMs)
  })
  return parsePlan(stdout)
}

export async function planTvRequest(
  request: string,
  apps: RokuApp[],
  activeApp: RokuApp | undefined,
  config?: TvctlAiConfig,
  modelOverride?: string,
  options: AiRunOptions & { mode?: PlannerMode } = {},
): Promise<{ plan: TvPlan; source: "ai" | "local"; fallbackReason?: string }> {
  const mode = options.mode ?? getPlannerMode()
  const local = (): TvPlan | undefined => deterministicPlan(request, apps, activeApp)

  if (mode === "local-only") {
    const plan = local()
    if (!plan) throw new Error("That request could not be planned locally.")
    return { plan, source: "local" }
  }

  if (mode === "local-first" || mode === "auto") {
    const plan = local()
    if (plan) return { plan, source: "local" }
    return { plan: await planWithAi(request, apps, config, modelOverride, options), source: "ai" }
  }

  try {
    const plan = await planWithAi(request, apps, config, modelOverride, {
      ...options,
      timeoutMs: options.timeoutMs ?? aiPlannerBudgetMs,
    })
    return { plan, source: "ai" }
  } catch (error) {
    if (options.signal?.aborted) throw error
    const plan = local()
    if (plan) {
      return {
        plan,
        source: "local",
        fallbackReason: error instanceof Error ? error.message : String(error),
      }
    }

    throw error
  }
}

export async function executePlan(client: RokuClient, apps: RokuApp[], plan: TvPlan): Promise<void> {
  for (const action of plan.actions) {
    switch (action.action) {
      case "launch":
        await launchApp(client, apps, action.app)
        break
      case "search": {
        const app = action.app ? findApp(apps, action.app) : undefined
        await client.searchBrowse(action.query, { providerId: app?.id, provider: app?.name, launch: action.launch })
        break
      }
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

export function deterministicPlan(request: string, apps: RokuApp[], activeApp?: RokuApp): TvPlan | undefined {
  const original = request.trim()
  const lower = original.toLowerCase()

  const searchMatch =
    original.match(/^(?:open|launch|start)\s+(.+?)\s+(?:and\s+)?(?:search|find)(?:\s+for)?\s+(.+)$/i) ??
    original.match(/^(?:on|in)\s+(.+?)\s+(?:search|find)(?:\s+for)?\s+(.+)$/i) ??
    original.match(/^(.+?)\s+(?:search|find)(?:\s+for)?\s+(.+)$/i) ??
    original.match(/^(?:search|find)(?:\s+for)?\s+(.+?)\s+(?:on|in)\s+(.+)$/i)

  if (searchMatch?.[1] && searchMatch[2]) {
    const first = searchMatch[1].trim()
    const second = searchMatch[2].trim()
    const appQuery = lower.startsWith("search") || lower.startsWith("find") ? second : first
    const query = lower.startsWith("search") || lower.startsWith("find") ? first : second
    const app = findApp(apps, appQuery)
    if (!app) return undefined

    return {
      summary: `Search ${app.name} for "${query}"`,
      actions: [{ action: "search", query, app: app.name }],
    }
  }

  const activeSearchMatch = original.match(/^(?:search|find)(?:\s+for)?\s+(.+)$/i)
  if (activeSearchMatch?.[1] && activeApp?.name) {
    const query = activeSearchMatch[1].trim()
    return {
      summary: `Search ${activeApp.name} for "${query}"`,
      actions: [{ action: "search", query, app: activeApp.name }],
    }
  }

  const launchMatch = original.match(/^(?:open|launch|start)\s+(.+)$/i)
  if (launchMatch?.[1]) {
    const app = findApp(apps, launchMatch[1].trim())
    if (!app) return undefined
    return {
      summary: `Launch ${app.name}`,
      actions: [{ action: "launch", app: app.name }],
    }
  }

  const keyPlan = planCommonRemoteKey(lower)
  if (keyPlan) return keyPlan

  const switchMatch = original.match(/^(?:switch|change|go)\s+(?:to\s+)?(.+)$/i)
  if (switchMatch?.[1]) {
    const app = findApp(apps, switchMatch[1].trim())
    if (!app) return undefined
    return {
      summary: `Launch ${app.name}`,
      actions: [{ action: "launch", app: app.name }],
    }
  }

  return undefined
}

function buildPrompt(request: string, apps: RokuApp[]): string {
  const appList = apps.map((app) => `${app.name} (${app.id})`).join(", ")
  return [
    "Convert this Roku TV request into JSON actions. Return ONLY JSON.",
    'Schema: {"summary":"short summary","actions":[...]}',
    'Actions: {"action":"launch","app":"app name or id"} | {"action":"search","query":"search text","app":"optional provider app name or id","launch":false} | {"action":"key","key":"Home|Back|Search|Select|Up|Down|Left|Right|Play|InstantReplay|Info|VolumeUp|VolumeDown|VolumeMute|PowerOff|PowerOn"} | {"action":"type","text":"text"} | {"action":"wait","ms":number}.',
    "For app/provider search, prefer the search action instead of opening the app and typing. Set app to the target installed app.",
    `Installed apps: ${appList}`,
    `User request: ${request}`,
  ].join("\n")
}

function planCommonRemoteKey(lower: string): TvPlan | undefined {
  const request = lower.trim()
  const keyMappings: Array<[RegExp, RokuKey, string]> = [
    [/\b(go\s+)?home\b/, "Home", "Go home"],
    [/\b(go\s+)?back\b/, "Back", "Go back"],
    [/\b(move\s+)?up\b/, "Up", "Move up"],
    [/\b(move\s+)?down\b/, "Down", "Move down"],
    [/\b(move\s+)?left\b/, "Left", "Move left"],
    [/\b(move\s+)?right\b/, "Right", "Move right"],
    [/\b(ok|select|choose)\b/, "Select", "Select"],
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

function providerError(provider: string, error: unknown, timeoutMs = aiTimeoutMs): Error {
  const anyError = error as { code?: string; signal?: string; killed?: boolean; message?: string }
  if (anyError.code === "ENOENT") {
    return new Error(`${provider} CLI is not installed or not on PATH.`)
  }
  if (anyError.code === "ABORT_ERR") {
    return new Error(`${provider} was canceled.`)
  }
  if (anyError.signal === "SIGTERM" || anyError.killed) {
    return new Error(`${provider} timed out after ${Math.round(timeoutMs / 1000)}s. Pick a faster model or set TVCTL_AI_PLANNER_BUDGET_MS.`)
  }
  return new Error(`${provider} failed: ${anyError.message ?? String(error)}`)
}

function getPlannerMode(): PlannerMode {
  const value = process.env.TVCTL_PLANNER
  if (value === "auto" || value === "ai-first" || value === "local-first" || value === "local-only") return value
  return "auto"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
