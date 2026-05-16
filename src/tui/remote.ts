import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { defaultAiConfig } from "../ai"
import { getAiConfig, setAiConfig } from "../config"
import { launchApp } from "../roku/apps"
import { RokuClient } from "../roku/client"
import type { RokuApp, RokuDevice, RokuKey } from "../types"
import { providers } from "./model"

type ViewMode = "remote" | "apps" | "settings"

interface RemoteState {
  activeApp?: RokuApp
  apps: RokuApp[]
  status: string
  view: ViewMode
  typing: boolean
  typeBuffer: string
  appFilter: string
  selectedAppIndex: number
  providerIndex: number
  aiModel: string
  editingModel: boolean
  lastKey?: string
}

export async function runRemote(device: RokuDevice): Promise<void> {
  const client = new RokuClient(device.host)
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  const aiConfig = await getAiConfig()
  const providerIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === (aiConfig?.provider ?? defaultAiConfig.provider)),
  )
  const state: RemoteState = {
    apps: [],
    status: "Connecting",
    view: "remote",
    typing: false,
    typeBuffer: "",
    appFilter: "",
    selectedAppIndex: 0,
    providerIndex,
    aiModel: aiConfig?.model ?? defaultAiConfig.model ?? providers[providerIndex]?.suggestions[0] ?? "",
    editingModel: false,
  }

  async function refresh(): Promise<void> {
    try {
      const [activeApp, apps] = await Promise.all([client.activeApp(), client.apps()])
      state.activeApp = activeApp
      state.apps = apps
      state.status = "Ready"
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Unable to refresh"
    }
    draw()
  }

  function draw(): void {
    const existing = renderer.root.getRenderable("tvctl-root")
    if (existing) renderer.root.remove("tvctl-root")
    const compact = renderer.terminalWidth < 72 || renderer.terminalHeight < 36

    renderer.root.add(
      Box(
        {
          id: "tvctl-root",
          width: "100%",
          height: "100%",
          padding: compact ? 0 : 1,
          gap: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#050505",
        },
        compact ? compactHeader(device, state) : header(device, state),
        Box(
          {
            width: compact ? 32 : 42,
            flexDirection: "column",
            alignItems: "center",
          },
          state.view === "apps"
            ? appDrawer(state, compact)
            : state.view === "settings"
              ? settingsPanel(state, compact)
              : remoteBody(state, compact),
        ),
        footer(state, compact),
      ),
    )
  }

  async function sendKey(key: RokuKey): Promise<void> {
    state.lastKey = key
    state.status = `Sending ${key}`
    draw()
    try {
      await client.keypress(key)
      state.status = `Sent ${key}`
    } catch (error) {
      state.status = error instanceof Error ? error.message : `Failed to send ${key}`
    }
    draw()
  }

  async function launchSelectedApp(): Promise<void> {
    const app = filteredApps(state)[state.selectedAppIndex]
    if (!app) return

    state.status = `Launching ${app.name}`
    draw()
    try {
      await launchApp(client, state.apps, app.id)
      state.status = `Launched ${app.name}`
      state.activeApp = app
      state.view = "remote"
      state.appFilter = ""
      state.selectedAppIndex = 0
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Launch failed"
    }
    draw()
  }

  async function submitText(): Promise<void> {
    const text = state.typeBuffer
    if (!text) {
      state.typing = false
      draw()
      return
    }

    state.status = `Typing ${text.length} chars`
    draw()
    try {
      await client.typeText(text)
      state.status = "Text sent"
      state.typeBuffer = ""
      state.typing = false
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Text send failed"
    }
    draw()
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    void handleKey(key)
  })

  async function handleKey(key: KeyEvent): Promise<void> {
    if (state.typing) {
      await handleTypingKey(key)
      return
    }

    if (key.name === "q" || key.name === "escape") {
      if (state.view === "apps" || state.view === "settings") {
        state.view = "remote"
        state.appFilter = ""
        state.selectedAppIndex = 0
        state.editingModel = false
        state.status = "Remote"
        draw()
        return
      }
      renderer.destroy()
      return
    }

    if (key.name === "a" || key.name === "tab") {
      state.view = state.view === "apps" ? "remote" : "apps"
      state.status = state.view === "apps" ? "Choose an app" : "Remote"
      draw()
      return
    }

    if (key.name === "c") {
      state.view = state.view === "settings" ? "remote" : "settings"
      state.editingModel = false
      state.status = state.view === "settings" ? "AI settings" : "Remote"
      draw()
      return
    }

    if (state.view === "apps") {
      await handleAppKey(key)
      return
    }

    if (state.view === "settings") {
      await handleSettingsKey(key)
      return
    }

    await handleRemoteKey(key)
  }

  async function handleTypingKey(key: KeyEvent): Promise<void> {
    if (key.name === "escape") {
      state.typing = false
      state.typeBuffer = ""
      state.status = "Typing canceled"
      draw()
      return
    }
    if (key.name === "return") {
      await submitText()
      return
    }
    if (key.name === "backspace") {
      state.typeBuffer = state.typeBuffer.slice(0, -1)
      draw()
      return
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      state.typeBuffer += key.sequence
      draw()
    }
  }

  async function handleAppKey(key: KeyEvent): Promise<void> {
    const apps = filteredApps(state)
    if (key.name === "up" || key.name === "k") {
      state.selectedAppIndex = Math.max(0, state.selectedAppIndex - 1)
      draw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      state.selectedAppIndex = Math.min(Math.max(0, apps.length - 1), state.selectedAppIndex + 1)
      draw()
      return
    }
    if (key.name === "return" || key.name === "space") {
      await launchSelectedApp()
      return
    }
    if (key.name === "backspace") {
      state.appFilter = state.appFilter.slice(0, -1)
      state.selectedAppIndex = 0
      draw()
      return
    }
    if (key.name === "delete") {
      state.appFilter = ""
      state.selectedAppIndex = 0
      draw()
      return
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      state.appFilter += key.sequence
      state.selectedAppIndex = 0
      draw()
    }
  }

  async function handleSettingsKey(key: KeyEvent): Promise<void> {
    if (key.name === "return") {
      const provider = providers[state.providerIndex] ?? providers[0]!
      const model = state.aiModel.trim()
      await setAiConfig({ provider: provider.id, model: model || undefined })
      state.status = `Saved ${provider.label}${model ? ` / ${model}` : ""}`
      state.editingModel = false
      draw()
      return
    }

    if (key.name === "tab") {
      state.editingModel = !state.editingModel
      draw()
      return
    }

    if (state.editingModel) {
      if (key.ctrl && key.name === "u") {
        state.aiModel = ""
        draw()
        return
      }
      if (key.name === "backspace") {
        state.aiModel = state.aiModel.slice(0, -1)
        draw()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        state.aiModel += key.sequence
        draw()
      }
      return
    }

    if (key.name === "up" || key.name === "k") {
      state.providerIndex = Math.max(0, state.providerIndex - 1)
      state.aiModel = providers[state.providerIndex]?.suggestions[0] ?? state.aiModel
      draw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      state.providerIndex = Math.min(providers.length - 1, state.providerIndex + 1)
      state.aiModel = providers[state.providerIndex]?.suggestions[0] ?? state.aiModel
      draw()
    }
  }

  async function handleRemoteKey(key: KeyEvent): Promise<void> {
    switch (key.name) {
      case "up":
      case "k":
        await sendKey("Up")
        return
      case "down":
      case "j":
        await sendKey("Down")
        return
      case "left":
      case "h":
        await sendKey("Left")
        return
      case "right":
      case "l":
        await sendKey("Right")
        return
      case "return":
      case "space":
        await sendKey("Select")
        return
      case "b":
        await sendKey("Back")
        return
      case "m":
        await sendKey("Home")
        return
      case "p":
        await sendKey("Play")
        return
      case "[":
        await sendKey("Rev")
        return
      case "]":
        await sendKey("Fwd")
        return
      case "r":
        await sendKey("InstantReplay")
        return
      case "o":
        await sendKey("PowerOn")
        return
      case "x":
        await sendKey("PowerOff")
        return
      case "+":
      case "=":
        await sendKey("VolumeUp")
        return
      case "-":
        await sendKey("VolumeDown")
        return
      case "0":
        await sendKey("VolumeMute")
        return
      case "v":
        await sendKey("VolumeMute")
        return
      case "?":
        await sendKey("Info")
        return
      case "s":
        await sendKey("Search")
        return
      case "i":
        state.typing = true
        state.typeBuffer = ""
        state.status = "Typing mode"
        draw()
        return
      case "f5":
        await refresh()
        return
    }
  }

  draw()
  await refresh()
}

function header(device: RokuDevice, state: RemoteState) {
  return Box(
    {
      width: 46,
      paddingX: 1,
      flexDirection: "column",
      alignItems: "center",
    },
    Text({ content: "tvctl", fg: "#6F1AB1" }),
    Text({ content: `${device.name} · ${state.activeApp?.name ?? "unknown"}`, fg: "#A1A1AA" }),
    Text({ content: state.status, fg: "#71717A" }),
  )
}

function compactHeader(device: RokuDevice, state: RemoteState) {
  return Box(
    { width: 36, flexDirection: "column", alignItems: "center" },
    Text({ content: `${device.name}`, fg: "#A1A1AA" }),
    Text({ content: `${state.activeApp?.name ?? "unknown"} · ${state.status}`, fg: "#71717A" }),
  )
}

function remoteBody(state: RemoteState, compact: boolean) {
  return Box(
    {
      width: compact ? 28 : 32,
      height: compact ? 28 : 36,
      borderStyle: "rounded",
      borderColor: "#222226",
      paddingX: compact ? 1 : 2,
      paddingY: compact ? 0 : 1,
      gap: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#111113",
    },
    Text({ content: "Roku", fg: "#7B2CBF" }),
    buttonRow([pillButton("ON", "o", "purple", compact), pillButton("OFF", "x", "dark", compact)]),
    buttonRow([pillButton("HOME", "m", "purple", compact), pillButton("BACK", "b", "dark", compact)]),
    dpad(compact),
    buttonRow([pillButton("SEARCH", "s", "dark", compact), pillButton("APPS", "a", "purple", compact)]),
    buttonRow([roundButton("VOL+", "+", compact), roundButton("MUTE", "0", compact), roundButton("VOL-", "-", compact)]),
    buttonRow([pillButton("REW", "[", "dark", compact), pillButton("PLAY", "p", "dark", compact), pillButton("FWD", "]", "dark", compact)]),
    buttonRow([pillButton("INFO", "?", "dark", compact), pillButton("REPLAY", "r", "dark", compact)]),
    typingPanel(state, compact),
    Text({ content: state.lastKey ? `Last: ${state.lastKey}` : "arrows / hjkl move", fg: "#71717A" }),
  )
}

function appDrawer(state: RemoteState, compact: boolean) {
  const apps = filteredApps(state)
  const visibleCount = compact ? 9 : 12
  const start = Math.max(0, Math.min(state.selectedAppIndex - Math.floor(visibleCount / 2), Math.max(0, apps.length - visibleCount)))
  const visibleApps = apps.slice(start, start + visibleCount)
  const rows = visibleApps.map((app, offset) => {
    const index = start + offset
    const selected = index === state.selectedAppIndex
    const labelWidth = compact ? 22 : 30
    const label = app.name.padEnd(labelWidth).slice(0, labelWidth)
    return Text({
      content: `${selected ? ">" : " "} ${label}`,
      fg: selected ? "#FFFFFF" : "#D4D4D8",
      bg: selected ? "#6F1AB1" : undefined,
    })
  })

  return Box(
    {
      width: compact ? 32 : 42,
      height: compact ? 30 : 34,
      borderStyle: "rounded",
      borderColor: "#1F1F23",
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#111113",
      title: " Apps ",
      titleAlignment: "center",
    },
    Text({ content: "Type to filter · Enter launches", fg: "#A1A1AA" }),
    Text({ content: state.appFilter ? `Search: ${state.appFilter}_` : "Search: _", fg: "#71717A" }),
    ...rows,
    Text({ content: `${apps.length ? start + 1 : 0}-${Math.min(start + visibleCount, apps.length)} of ${apps.length}`, fg: "#71717A" }),
  )
}

function settingsPanel(state: RemoteState, compact: boolean) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return Box(
    {
      width: compact ? 32 : 42,
      height: compact ? 30 : 34,
      borderStyle: "rounded",
      borderColor: "#1F1F23",
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#111113",
      title: " AI ",
      titleAlignment: "center",
    },
    Text({ content: "Provider", fg: "#A1A1AA" }),
    ...providers.map((item, index) =>
      Text({
        content: `${index === state.providerIndex ? ">" : " "} ${item.label.padEnd(compact ? 8 : 9)}`,
        fg: index === state.providerIndex ? "#FFFFFF" : "#D4D4D8",
        bg: index === state.providerIndex ? "#6F1AB1" : undefined,
      }),
    ),
    Text({ content: "Model", fg: "#A1A1AA" }),
    Box(
      {
        width: compact ? 26 : 34,
        borderStyle: "rounded",
        borderColor: state.editingModel ? "#6F1AB1" : "#2B2B30",
        backgroundColor: "#18181B",
        paddingX: 1,
        paddingY: compact ? 0 : 1,
      },
      Text({
        content: truncate(`${state.aiModel}${state.editingModel ? "_" : ""}`, compact ? 22 : 30),
        fg: state.editingModel ? "#FFFFFF" : "#D4D4D8",
      }),
    ),
    Text({ content: truncate(provider.description, compact ? 26 : 34), fg: "#71717A" }),
    Text({ content: truncate(`Try: ${provider.suggestions.join(", ")}`, compact ? 26 : 34), fg: "#71717A" }),
    Text({ content: "Tab edit · Enter save · Esc remote", fg: "#A1A1AA" }),
  )
}

function typingPanel(state: RemoteState, compact: boolean) {
  const text = state.typing ? `Type: ${state.typeBuffer}_` : "Press i to type on TV"
  return Box(
    {
      width: compact ? 24 : 28,
      borderStyle: "rounded",
      borderColor: state.typing ? "#6F1AB1" : "#27272A",
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      backgroundColor: "#18181B",
    },
    Text({ content: text, fg: state.typing ? "#FFFFFF" : "#71717A" }),
  )
}

function footer(state: RemoteState, compact: boolean) {
  const content =
    state.view === "apps"
      ? "Apps: type to filter · Enter launch · Esc close"
      : state.view === "settings"
        ? "AI: up/down provider · Tab edit model · Enter save · Esc close"
      : compact
        ? "Enter OK · A apps · C AI · +/- volume · Q quit"
        : "Enter OK · A apps · C AI · I type · +/- volume · 0 mute · O on · X off · Q quit"

  return Box(
    {
      width: compact ? 42 : 72,
      borderStyle: "rounded",
      borderColor: "#1F1F23",
      paddingX: 2,
      paddingY: 1,
      backgroundColor: "#111113",
    },
    Text({ content, fg: "#A1A1AA" }),
  )
}

function buttonRow(items: ReturnType<typeof pillButton>[]) {
  return Box({ flexDirection: "row", gap: 1, alignItems: "center" }, ...items)
}

function pillButton(label: string, key: string, variant: "purple" | "dark", compact: boolean) {
  const width = compact ? 7 : label.length > 4 ? 10 : 8
  const bg = variant === "purple" ? "#6F1AB1" : "#1A1A1D"
  const border = variant === "purple" ? "#7B2CBF" : "#2B2B30"
  return Box(
    {
      width,
      borderStyle: "rounded",
      borderColor: border,
      backgroundColor: bg,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
    },
    Text({ content: compact ? label : `${label} ${key}`, fg: "#FFFFFF" }),
  )
}

function roundButton(label: string, key: string, compact: boolean) {
  const width = compact ? 7 : 8
  return Box(
    {
      width,
      borderStyle: "rounded",
      borderColor: "#2B2B30",
      backgroundColor: "#1A1A1D",
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
    },
    Text({ content: compact ? label : `${label} ${key}`, fg: "#FFFFFF" }),
  )
}

function dpad(compact: boolean) {
  return Box(
    {
      width: compact ? 23 : 26,
      borderStyle: "rounded",
      borderColor: "#2B2B30",
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#151518",
    },
    Text({ content: "▲", fg: "#FFFFFF" }),
    Text({ content: "◀   OK   ▶", fg: "#FFFFFF" }),
    Text({ content: "▼", fg: "#FFFFFF" }),
  )
}

function filteredApps(state: RemoteState): RokuApp[] {
  const query = state.appFilter.toLowerCase().trim()
  if (!query) return state.apps
  return state.apps.filter((app) => app.name.toLowerCase().includes(query) || app.id.toLowerCase().includes(query))
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`
}
