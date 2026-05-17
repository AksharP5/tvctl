import { Box, MouseButton, Text, createCliRenderer, type BoxOptions, type KeyEvent, type MouseEvent, type VChild } from "@opentui/core"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { defaultAiConfig } from "../ai"
import { getAiConfig, setAiConfig } from "../config"
import type { TvctlAiProvider } from "../types"

const execFileAsync = promisify(execFile)

export interface ProviderOption {
  id: TvctlAiProvider
  label: string
  description: string
  command: string
  checkArgs: string[]
  setupHint: string
  suggestions: string[]
}

const modelCache = new Map<TvctlAiProvider, string[]>()

export const providers: ProviderOption[] = [
  {
    id: "opencode",
    label: "OpenCode",
    description: "Recommended default. Uses OpenCode as the provider/model bridge.",
    command: "opencode",
    checkArgs: ["auth", "list"],
    setupHint: "Install OpenCode, then run `opencode auth login`.",
    suggestions: ["opencode/big-pickle", "openai/gpt-5.1-codex-mini", "openai/gpt-5.4"],
  },
  {
    id: "codex",
    label: "Codex",
    description: "Uses Codex CLI subscriptions/auth with `codex exec`.",
    command: "codex",
    checkArgs: ["login", "status"],
    setupHint: "Install Codex CLI, then run `codex login`.",
    suggestions: ["gpt-5.1-codex-mini", "gpt-5.4", "gpt-5.2"],
  },
  {
    id: "claude",
    label: "Claude",
    description: "Uses Claude Code CLI subscriptions/auth with `claude -p`.",
    command: "claude",
    checkArgs: ["--version"],
    setupHint: "Install Claude Code, then run `claude login`.",
    suggestions: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  },
]

export async function loadProviderModels(provider: ProviderOption): Promise<string[]> {
  const cached = modelCache.get(provider.id)
  if (cached?.length) return cached

  let models: string[] = []
  try {
    if (provider.id === "opencode") {
      const { stdout } = await execFileAsync(provider.command, ["models"], { timeout: 10_000, maxBuffer: 1024 * 1024 })
      models = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.includes(" "))
    } else if (provider.id === "codex") {
      const { stdout } = await execFileAsync(provider.command, ["debug", "models"], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
      const parsed = JSON.parse(stdout) as { models?: Array<{ slug?: string; visibility?: string }> }
      models = (parsed.models ?? [])
        .filter((model) => model.slug && model.visibility !== "hidden")
        .map((model) => model.slug!)
    } else if (provider.id === "claude") {
      const { stdout } = await execFileAsync(provider.command, ["models"], { timeout: 10_000, maxBuffer: 1024 * 1024 })
      models = stdout
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((model): model is string => Boolean(model))
    }
  } catch {
    models = []
  }

  const merged = uniqueModels([...models, ...provider.suggestions])
  modelCache.set(provider.id, merged)
  return merged
}

export async function runModelSetup(): Promise<void> {
  const existing = await getAiConfig()
  let providerIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === (existing?.provider ?? defaultAiConfig.provider)),
  )
  let selectedModelIndex = modelIndexFor(providerIndex, existing?.model ?? defaultAiConfig.model)
  let providerModels = providers[providerIndex]?.suggestions ?? []
  let model = existing?.model ?? defaultAiConfig.model ?? providerModels[0] ?? ""
  let editingModel = false
  let status = "Choose a provider and model, then save."

  const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true })

  function draw(): void {
    const existingRoot = renderer.root.getRenderable("tvctl-model-root")
    if (existingRoot) renderer.root.remove("tvctl-model-root")

    const provider = providers[providerIndex] ?? providers[0]!
    const compact = renderer.terminalWidth < 76
    const width = compact ? Math.min(64, Math.max(54, renderer.terminalWidth - 4)) : 76
    const leftWidth = compact ? 18 : 22
    const rightWidth = compact ? width - leftWidth - 8 : 48
    const innerWidth = width - 6
    renderer.root.add(
      Box(
        {
          id: "tvctl-model-root",
          width: "100%",
          height: "100%",
          padding: 1,
          gap: 1,
          flexDirection: "column",
          backgroundColor: "#0B0F14",
        },
        Box(
          { width, borderStyle: "rounded", borderColor: "#2F81F7", padding: 1, flexDirection: "column", gap: 1 },
          Text({ content: "tvctl model setup", fg: "#F0F6FC" }),
          ...textBlock(status, innerWidth, 2, "#A5D6FF"),
        ),
        Box(
          { width, borderStyle: "rounded", borderColor: editingModel ? "#F2CC60" : "#30363D", padding: 1, flexDirection: "column", gap: 1 },
          Box(
            { width: innerWidth, flexDirection: "row", justifyContent: "space-between" },
            Text({ content: `Provider: ${provider.label}`, fg: "#F0F6FC" }),
            Text({ content: `${providerModels.length ? selectedModelIndex + 1 : 0}/${providerModels.length}`, fg: "#8B949E" }),
          ),
          Box(
            { width: innerWidth, flexDirection: "row", gap: 2, alignItems: "flex-start" },
            Box(
              { width: leftWidth, height: 14, flexDirection: "column", gap: 1 },
              Text({ content: "Provider", fg: "#8B949E" }),
              ...providers.map((item, index) =>
                clickable(
                  () => chooseProvider(index),
                  { width: leftWidth, backgroundColor: index === providerIndex ? "#27272F" : undefined, paddingX: 1 },
                  Text({
                    content: `${index === providerIndex ? ">" : " "} ${fitLine(item.label, leftWidth - 3)}`,
                    fg: index === providerIndex ? "#FFFFFF" : "#D0D7DE",
                  }),
                ),
              ),
              smallAction("Cancel", () => renderer.destroy()),
              smallAction("Save", handleSave),
            ),
            Box(
              { width: rightWidth, height: 14, flexDirection: "column", gap: 1 },
              Text({ content: "Models", fg: "#8B949E" }),
              ...visibleModelRows(providerModels, selectedModelIndex, 8).map(({ item, index }) =>
                clickable(
                  () => chooseModel(index),
                  { width: rightWidth, backgroundColor: item === model ? "#27272F" : undefined, paddingX: 1 },
                  Text({
                    content: `${item === model ? ">" : " "} ${middleEllipsis(item, rightWidth - 4)}`,
                    fg: item === model ? "#FFFFFF" : "#D0D7DE",
                  }),
                ),
              ),
            ),
          ),
          Box(
            {
              width: innerWidth,
              height: 3,
              backgroundColor: editingModel ? "#2A173F" : "#17171B",
              paddingX: 1,
              onMouseUp: clickHandler(() => {
                editingModel = !editingModel
                draw()
              }),
            },
            Text({
              content: editingModel ? wrapInput(`Custom: ${model}_`, innerWidth - 2, 2) : wrapInput(`Selected: ${model}`, innerWidth - 2, 2),
              fg: editingModel ? "#FFFFFF" : "#D0D7DE",
            }),
          ),
          ...textBlock(provider.setupHint, innerWidth, 2, "#8B949E"),
        ),
      ),
    )
  }

  function chooseProvider(index: number): void {
    providerIndex = index
    providerModels = providers[providerIndex]?.suggestions ?? []
    selectedModelIndex = 0
    model = providerModels[0] ?? model
    editingModel = false
    draw()
    void refreshModels()
  }

  function chooseModel(index: number): void {
    selectedModelIndex = index
    model = providerModels[index] ?? model
    editingModel = false
    draw()
  }

  async function refreshModels(): Promise<void> {
    const provider = providers[providerIndex] ?? providers[0]!
    status = `Loading ${provider.label} models...`
    draw()
    providerModels = await loadProviderModels(provider)
    selectedModelIndex = modelIndexForList(providerModels, model)
    if (!providerModels.includes(model)) {
      selectedModelIndex = 0
      model = providerModels[0] ?? model
    }
    status = `${provider.label} models loaded`
    draw()
  }

  async function handleSave(): Promise<void> {
    const provider = providers[providerIndex] ?? providers[0]!
    await setAiConfig({ provider: provider.id, model: model.trim() || undefined })
    status = `Saved ${provider.label}${model.trim() ? ` / ${model.trim()}` : ""}`
    draw()
    setTimeout(() => renderer.destroy(), 700)
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    void handleKey(key)
  })

  async function handleKey(key: KeyEvent): Promise<void> {
    if (key.name === "escape" || key.name === "q") {
      renderer.destroy()
      return
    }

    if (key.name === "return") {
      await handleSave()
      return
    }

    if (key.name === "tab") {
      editingModel = !editingModel
      draw()
      return
    }

    if (editingModel) {
      if (key.ctrl && key.name === "u") {
        model = ""
        selectedModelIndex = 0
        draw()
        return
      }
      if (key.name === "backspace") {
        model = model.slice(0, -1)
        selectedModelIndex = modelIndexFor(providerIndex, model)
        draw()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        model += key.sequence
        selectedModelIndex = modelIndexFor(providerIndex, model)
        draw()
      }
      return
    }

    if (key.name === "left" || key.name === "h") {
      chooseProvider(Math.max(0, providerIndex - 1))
      return
    }
    if (key.name === "right" || key.name === "l") {
      chooseProvider(Math.min(providers.length - 1, providerIndex + 1))
      return
    }
    if (key.name === "up" || key.name === "k") {
      chooseModel(Math.max(0, selectedModelIndex - 1))
      return
    }
    if (key.name === "down" || key.name === "j") {
      const max = Math.max(0, providerModels.length - 1)
      chooseModel(Math.min(max, selectedModelIndex + 1))
      return
    }
    if (key.name === "e") {
      editingModel = true
      draw()
    }
  }

  draw()
  void refreshModels()
}

function modelIndexFor(providerIndex: number, model?: string): number {
  const suggestions = providers[providerIndex]?.suggestions ?? []
  return modelIndexForList(suggestions, model)
}

function modelIndexForList(suggestions: string[], model?: string): number {
  const index = suggestions.findIndex((item) => item === model)
  return index >= 0 ? index : 0
}

function visibleModelRows(models: string[], selectedIndex: number, count: number): Array<{ item: string; index: number }> {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), Math.max(0, models.length - count)))
  return models.slice(start, start + count).map((item, offset) => ({ item, index: start + offset }))
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))]
}

function fitLine(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function middleEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength))
  const head = Math.ceil((maxLength - 1) * 0.6)
  const tail = Math.max(1, maxLength - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function wrapInput(value: string, width: number, maxLines: number): string {
  const lines = wrapWords(value, width)
  if (lines.length <= maxLines) return padLines(lines, maxLines).join("\n")

  const visible = lines.slice(lines.length - maxLines)
  visible[0] = fitLine(`...${visible[0]}`, width)
  return visible.join("\n")
}

function textBlock(value: string, width: number, maxLines: number, fg: string) {
  return wrapWords(value, width)
    .slice(0, maxLines)
    .map((line) => Text({ content: line, fg }))
}

function wrapWords(value: string, width: number): string[] {
  const words = value.replace(/\s+/g, " ").split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width) {
      if (line) lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

function padLines(lines: string[], count: number): string[] {
  const padded = [...lines]
  while (padded.length < count) padded.push("")
  return padded
}

function clickable(onClick: () => void | Promise<void>, options: BoxOptions, ...children: VChild[]) {
  return Box({ ...options, onMouseUp: clickHandler(onClick) }, ...children)
}

function smallAction(label: string, onClick: () => void | Promise<void>) {
  return clickable(onClick, { width: 10, backgroundColor: "#27272F", paddingX: 1, alignItems: "center" }, Text({ content: label, fg: "#FFFFFF" }))
}

function clickHandler(onClick: () => void | Promise<void>) {
  return (event: MouseEvent): void => {
    if (event.button !== MouseButton.LEFT) return
    event.stopPropagation()
    void onClick()
  }
}
