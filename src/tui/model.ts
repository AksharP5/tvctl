import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { defaultAiConfig } from "../ai"
import { getAiConfig, setAiConfig } from "../config"
import type { TvctlAiProvider } from "../types"

interface ProviderOption {
  id: TvctlAiProvider
  label: string
  description: string
  suggestions: string[]
}

const providers: ProviderOption[] = [
  {
    id: "opencode",
    label: "OpenCode",
    description: "Recommended default. Uses OpenCode as the provider/model bridge.",
    suggestions: ["opencode/big-pickle", "openai/gpt-5.1-codex-mini", "openai/gpt-5.4"],
  },
  {
    id: "codex",
    label: "Codex",
    description: "Uses Codex CLI subscriptions/auth with `codex exec`.",
    suggestions: ["gpt-5.1-codex-mini", "gpt-5.4", "gpt-5.2"],
  },
  {
    id: "claude",
    label: "Claude",
    description: "Uses Claude Code CLI subscriptions/auth with `claude -p`.",
    suggestions: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  },
]

export async function runModelSetup(): Promise<void> {
  const existing = await getAiConfig()
  let providerIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === (existing?.provider ?? defaultAiConfig.provider)),
  )
  let model = existing?.model ?? defaultAiConfig.model ?? providers[providerIndex]?.suggestions[0] ?? ""
  let editingModel = false
  let status = "Choose a provider, edit the model, then press Enter to save."

  const renderer = await createCliRenderer({ exitOnCtrlC: true })

  function draw(): void {
    const existingRoot = renderer.root.getRenderable("tvctl-model-root")
    if (existingRoot) renderer.root.remove("tvctl-model-root")

    const provider = providers[providerIndex] ?? providers[0]!
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
          { borderStyle: "rounded", borderColor: "#2F81F7", padding: 1, flexDirection: "column", gap: 1 },
          Text({ content: "tvctl model setup", fg: "#F0F6FC" }),
          Text({ content: status, fg: "#A5D6FF" }),
        ),
        Box(
          { borderStyle: "rounded", borderColor: "#30363D", padding: 1, flexDirection: "column", gap: 1 },
          ...providers.map((item, index) =>
            Text({
              content: `${index === providerIndex ? ">" : " "} ${item.label.padEnd(9)} ${item.description}`,
              fg: index === providerIndex ? "#0B0F14" : "#D0D7DE",
              bg: index === providerIndex ? "#F2CC60" : undefined,
            }),
          ),
        ),
        Box(
          { borderStyle: "rounded", borderColor: editingModel ? "#F2CC60" : "#30363D", padding: 1, flexDirection: "column", gap: 1 },
          Text({ content: `Provider: ${provider.label}`, fg: "#F0F6FC" }),
          Text({ content: `Model: ${model}${editingModel ? "_" : ""}`, fg: editingModel ? "#F2CC60" : "#D0D7DE" }),
          Text({ content: `Suggestions: ${provider.suggestions.join(", ")}`, fg: "#8B949E" }),
        ),
        Box(
          { borderStyle: "rounded", borderColor: "#30363D", padding: 1, flexDirection: "column" },
          Text({ content: "Up/Down provider · Tab edit model · Ctrl+U clear · Enter save · Esc/q cancel", fg: "#8B949E" }),
          Text({ content: "OpenCode + big-pickle is the default free suggestion, but fast paid models are better for conversational control.", fg: "#8B949E" }),
        ),
      ),
    )
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
      const provider = providers[providerIndex] ?? providers[0]!
      await setAiConfig({ provider: provider.id, model: model.trim() || undefined })
      status = `Saved ${provider.label}${model.trim() ? ` / ${model.trim()}` : ""}`
      draw()
      setTimeout(() => renderer.destroy(), 700)
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
        draw()
        return
      }
      if (key.name === "backspace") {
        model = model.slice(0, -1)
        draw()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        model += key.sequence
        draw()
      }
      return
    }

    if (key.name === "up" || key.name === "k") {
      providerIndex = Math.max(0, providerIndex - 1)
      model = providers[providerIndex]?.suggestions[0] ?? model
      draw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      providerIndex = Math.min(providers.length - 1, providerIndex + 1)
      model = providers[providerIndex]?.suggestions[0] ?? model
      draw()
    }
  }

  draw()
}
