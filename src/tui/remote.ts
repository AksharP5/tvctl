import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { defaultAiConfig, deterministicPlan, executePlan, planWithAi } from "../ai"
import { getAiConfig, setAiConfig, setDefaultDevice } from "../config"
import { launchApp } from "../roku/apps"
import { RokuClient } from "../roku/client"
import { discoverRokus } from "../roku/discover"
import type { RokuApp, RokuDevice, RokuKey } from "../types"
import { providers } from "./model"

const execFileAsync = promisify(execFile)

type ViewMode = "remote" | "apps" | "settings" | "ask" | "tvs"

interface RemoteState {
  activeApp?: RokuApp
  apps: RokuApp[]
  devices: RokuDevice[]
  status: string
  view: ViewMode
  typing: boolean
  typeBuffer: string
  appFilter: string
  selectedAppIndex: number
  selectedDeviceIndex: number
  providerIndex: number
  aiModel: string
  editingModel: boolean
  providerStatus: string
  providerStatusOk: boolean
  askBuffer: string
  askBusy: boolean
  lastKey?: string
}

export async function runRemote(device: RokuDevice): Promise<void> {
  let currentDevice = device
  let client = new RokuClient(currentDevice.host)
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  const aiConfig = await getAiConfig()
  const providerIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === (aiConfig?.provider ?? defaultAiConfig.provider)),
  )
  const state: RemoteState = {
    apps: [],
    devices: [device],
    status: "Connecting",
    view: "remote",
    typing: false,
    typeBuffer: "",
    appFilter: "",
    selectedAppIndex: 0,
    selectedDeviceIndex: 0,
    providerIndex,
    aiModel: aiConfig?.model ?? defaultAiConfig.model ?? providers[providerIndex]?.suggestions[0] ?? "",
    editingModel: false,
    providerStatus: "Provider not checked",
    providerStatusOk: false,
    askBuffer: "",
    askBusy: false,
  }

  async function refresh(): Promise<void> {
    try {
      const [activeApp, apps] = await Promise.all([client.activeApp(), client.apps()])
      state.activeApp = activeApp
      state.apps = apps
      state.status = `${currentDevice.name} ready`
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
          backgroundColor: "#030304",
        },
        compact ? compactHeader(currentDevice, state) : header(currentDevice, state),
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
              : state.view === "ask"
                ? askPanel(state, compact)
                : state.view === "tvs"
                  ? tvPanel(state, currentDevice, compact)
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

  async function refreshDevices(): Promise<void> {
    state.status = "Finding Roku TVs"
    draw()
    try {
      const devices = await discoverRokus()
      state.devices = devices.length > 0 ? devices : [currentDevice]
      const currentIndex = state.devices.findIndex((item) => item.host === currentDevice.host)
      state.selectedDeviceIndex = currentIndex >= 0 ? currentIndex : 0
      state.status = `${state.devices.length} Roku TV${state.devices.length === 1 ? "" : "s"} found`
    } catch (error) {
      state.status = error instanceof Error ? error.message : "TV discovery failed"
    }
    draw()
  }

  async function refreshProviderStatus(): Promise<void> {
    const provider = providers[state.providerIndex] ?? providers[0]!
    state.providerStatus = `Checking ${provider.label}`
    state.providerStatusOk = false
    draw()
    try {
      await execFileAsync(provider.command, provider.checkArgs, { timeout: 5000, maxBuffer: 128 * 1024 })
      state.providerStatus = `${provider.label} CLI ready`
      state.providerStatusOk = true
    } catch (error) {
      const anyError = error as { code?: string; killed?: boolean; signal?: string }
      if (anyError.code === "ENOENT") {
        state.providerStatus = `${provider.label} CLI not installed`
      } else if (anyError.killed || anyError.signal === "SIGTERM") {
        state.providerStatus = `${provider.label} check timed out`
      } else {
        state.providerStatus = `${provider.label} needs login/setup`
      }
      state.providerStatusOk = false
    }
    draw()
  }

  async function switchDevice(): Promise<void> {
    const next = state.devices[state.selectedDeviceIndex]
    if (!next) return

    currentDevice = next
    client = new RokuClient(next.host)
    await setDefaultDevice(next)
    state.activeApp = undefined
    state.apps = []
    state.view = "remote"
    state.status = `Switched to ${next.name}`
    draw()
    await refresh()
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
      if (state.view === "apps" || state.view === "settings" || state.view === "ask" || state.view === "tvs") {
        state.view = "remote"
        state.appFilter = ""
        state.selectedAppIndex = 0
        state.editingModel = false
        state.askBusy = false
        state.status = "Remote"
        draw()
        return
      }
      renderer.destroy()
      return
    }

    if (state.view === "apps") {
      await handleAppKey(key)
      return
    }

    if (state.view === "ask") {
      await handleAskKey(key)
      return
    }

    if (state.view === "settings") {
      await handleSettingsKey(key)
      return
    }

    if (state.view === "tvs") {
      await handleTvKey(key)
      return
    }

    if (key.name === "a" || key.name === "tab") {
      state.view = "apps"
      state.status = "Choose an app"
      draw()
      return
    }

    if (key.name === "/") {
      state.view = "ask"
      state.askBuffer = ""
      state.status = "Ask tvctl"
      draw()
      void refreshProviderStatus()
      return
    }

    if (key.name === "c") {
      state.view = "settings"
      state.editingModel = false
      state.status = "AI settings"
      draw()
      void refreshProviderStatus()
      return
    }

    if (key.name === "t") {
      state.view = "tvs"
      state.status = "Choose a TV"
      draw()
      void refreshDevices()
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

  async function handleAskKey(key: KeyEvent): Promise<void> {
    if (state.askBusy) return

    if (key.name === "return") {
      const request = state.askBuffer.trim()
      if (!request) return

      state.askBusy = true
      state.status = `Planning: ${request}`
      draw()
      try {
        let plan = deterministicPlan(request, state.apps)
        if (!plan) {
          const provider = providers[state.providerIndex] ?? providers[0]!
          plan = await planWithAi(request, state.apps, { provider: provider.id, model: state.aiModel.trim() || undefined })
        }
        state.status = plan.summary
        draw()
        await executePlan(client, state.apps, plan)
        state.status = `Done: ${plan.summary}`
        state.askBuffer = ""
        state.view = "remote"
        await refresh()
      } catch (error) {
        state.status = error instanceof Error ? error.message : "Ask failed"
        state.askBusy = false
        draw()
      }
      return
    }

    if (key.ctrl && key.name === "u") {
      state.askBuffer = ""
      draw()
      return
    }
    if (key.name === "backspace") {
      state.askBuffer = state.askBuffer.slice(0, -1)
      draw()
      return
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      state.askBuffer += key.sequence
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
      void refreshProviderStatus()
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
        state.providerStatus = "Save to check provider"
        state.providerStatusOk = false
        draw()
        return
      }
      if (key.name === "backspace") {
        state.aiModel = state.aiModel.slice(0, -1)
        state.providerStatus = "Save to check provider"
        state.providerStatusOk = false
        draw()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        state.aiModel += key.sequence
        state.providerStatus = "Save to check provider"
        state.providerStatusOk = false
        draw()
      }
      return
    }

    if (key.name === "up" || key.name === "k") {
      state.providerIndex = Math.max(0, state.providerIndex - 1)
      state.aiModel = providers[state.providerIndex]?.suggestions[0] ?? state.aiModel
      draw()
      void refreshProviderStatus()
      return
    }
    if (key.name === "down" || key.name === "j") {
      state.providerIndex = Math.min(providers.length - 1, state.providerIndex + 1)
      state.aiModel = providers[state.providerIndex]?.suggestions[0] ?? state.aiModel
      draw()
      void refreshProviderStatus()
    }
  }

  async function handleTvKey(key: KeyEvent): Promise<void> {
    if (key.name === "up" || key.name === "k") {
      state.selectedDeviceIndex = Math.max(0, state.selectedDeviceIndex - 1)
      draw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      state.selectedDeviceIndex = Math.min(Math.max(0, state.devices.length - 1), state.selectedDeviceIndex + 1)
      draw()
      return
    }
    if (key.name === "return" || key.name === "space") {
      await switchDevice()
      return
    }
    if (key.name === "f5" || key.name === "r") {
      await refreshDevices()
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
      width: 60,
      paddingX: 1,
      flexDirection: "column",
      alignItems: "center",
    },
    Text({ content: "tvctl", fg: "#8B5CF6" }),
    Text({ content: `${device.name}  ·  ${state.activeApp?.name ?? "unknown"}`, fg: "#F4F4F5" }),
    Text({ content: state.status, fg: "#8B8B93" }),
  )
}

function compactHeader(device: RokuDevice, state: RemoteState) {
  return Box(
    { width: 36, flexDirection: "column", alignItems: "center" },
    Text({ content: `${device.name}`, fg: "#F4F4F5" }),
    Text({ content: `${state.activeApp?.name ?? "unknown"} · ${state.status}`, fg: "#8B8B93" }),
  )
}

function remoteBody(state: RemoteState, compact: boolean) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return Box(
    {
      width: compact ? 30 : 38,
      height: compact ? 29 : 39,
      paddingX: compact ? 2 : 3,
      paddingY: compact ? 0 : 1,
      gap: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "ROKU", fg: "#A855F7" }),
    buttonRow([pillButton("ON", "o", "quiet", compact), pillButton("OFF", "x", "quiet", compact)]),
    buttonRow([pillButton("HOME", "m", "purple", compact), pillButton("BACK", "b", "quiet", compact)]),
    dpad(compact),
    buttonRow([pillButton("ASK", "/", "purple", compact), pillButton("APPS", "a", "purple", compact)]),
    buttonRow([pillButton("TVS", "t", "quiet", compact), pillButton("AI", "c", "quiet", compact)]),
    buttonRow([roundButton("VOL+", "+", compact), roundButton("MUTE", "0", compact), roundButton("VOL-", "-", compact)]),
    buttonRow([pillButton("REW", "[", "quiet", compact), pillButton("PLAY", "p", "quiet", compact), pillButton("FWD", "]", "quiet", compact)]),
    buttonRow([pillButton("SEARCH", "s", "quiet", compact), pillButton("INFO", "?", "quiet", compact), pillButton("REPLAY", "r", "quiet", compact)]),
    typingPanel(state, compact),
    Text({ content: truncate(`AI ${provider.label} · ${state.aiModel}`, compact ? 24 : 28), fg: "#8B8B93" }),
    Text({ content: state.lastKey ? `Last ${state.lastKey}` : "arrows / hjkl move", fg: "#8B8B93" }),
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
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "Apps", fg: "#F4F4F5" }),
    Text({ content: state.appFilter ? `filter ${state.appFilter}_` : "type to filter", fg: "#8B8B93" }),
    ...rows,
    Text({ content: `${apps.length ? start + 1 : 0}-${Math.min(start + visibleCount, apps.length)} of ${apps.length} · Enter launches`, fg: "#8B8B93" }),
  )
}

function settingsPanel(state: RemoteState, compact: boolean) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return Box(
    {
      width: compact ? 32 : 42,
      height: compact ? 30 : 34,
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "AI settings", fg: "#F4F4F5" }),
    Text({ content: truncate(`Using ${provider.label} · ${state.aiModel}`, compact ? 26 : 34), fg: "#C084FC" }),
    Text({ content: truncate(state.providerStatus, compact ? 26 : 34), fg: state.providerStatusOk ? "#86EFAC" : "#FCA5A5" }),
    Text({ content: "Provider", fg: "#A1A1AA" }),
    ...providers.map((item, index) =>
      Text({
        content: `${index === state.providerIndex ? ">" : " "} ${item.label.padEnd(compact ? 8 : 9)}`,
        fg: index === state.providerIndex ? "#FFFFFF" : "#D4D4D8",
        bg: index === state.providerIndex ? "#7C3AED" : undefined,
      }),
    ),
    Text({ content: "Model", fg: "#A1A1AA" }),
    Box(
      {
        width: compact ? 26 : 34,
        backgroundColor: state.editingModel ? "#2A173F" : "#17171B",
        paddingX: 1,
        paddingY: compact ? 0 : 1,
      },
      Text({
        content: truncate(`${state.aiModel}${state.editingModel ? "_" : ""}`, compact ? 22 : 30),
        fg: state.editingModel ? "#FFFFFF" : "#D4D4D8",
      }),
    ),
    Text({ content: truncate(provider.description, compact ? 26 : 34), fg: "#8B8B93" }),
    Text({ content: truncate(provider.setupHint, compact ? 26 : 34), fg: "#8B8B93" }),
    Text({ content: truncate(`Try ${provider.suggestions.join(", ")}`, compact ? 26 : 34), fg: "#8B8B93" }),
    Text({ content: "Tab edit · Enter save · Esc remote", fg: "#A1A1AA" }),
  )
}

function askPanel(state: RemoteState, compact: boolean) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return Box(
    {
      width: compact ? 32 : 42,
      height: compact ? 30 : 34,
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "Ask tvctl", fg: "#F4F4F5" }),
    Text({ content: truncate(`Using ${provider.label} · ${state.aiModel}`, compact ? 26 : 34), fg: "#C084FC" }),
    Text({ content: truncate(state.providerStatus, compact ? 26 : 34), fg: state.providerStatusOk ? "#86EFAC" : "#FCA5A5" }),
    Box(
      {
        width: compact ? 26 : 34,
        height: compact ? 5 : 7,
        backgroundColor: state.askBusy ? "#2A173F" : "#17171B",
        paddingX: 1,
        paddingY: 1,
      },
      Text({
        content: truncate(`${state.askBuffer}${state.askBusy ? "" : "_"}`, compact ? 22 : 30),
        fg: "#FFFFFF",
      }),
    ),
    Text({ content: "Examples", fg: "#A1A1AA" }),
    Text({ content: "open prime", fg: "#D4D4D8" }),
    Text({ content: "search youtube for drake album", fg: "#D4D4D8" }),
    Text({ content: "mute the tv", fg: "#D4D4D8" }),
    Text({ content: state.askBusy ? "Running..." : "Enter run · Ctrl+U clear · Esc remote", fg: "#8B8B93" }),
  )
}

function tvPanel(state: RemoteState, currentDevice: RokuDevice, compact: boolean) {
  const visibleCount = compact ? 10 : 12
  const start = Math.max(
    0,
    Math.min(state.selectedDeviceIndex - Math.floor(visibleCount / 2), Math.max(0, state.devices.length - visibleCount)),
  )
  const visibleDevices = state.devices.slice(start, start + visibleCount)

  return Box(
    {
      width: compact ? 32 : 42,
      height: compact ? 30 : 34,
      paddingX: compact ? 2 : 3,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "Roku TVs", fg: "#F4F4F5" }),
    Text({ content: "Enter switches · R refreshes", fg: "#8B8B93" }),
    ...visibleDevices.map((device, offset) => {
      const index = start + offset
      const selected = index === state.selectedDeviceIndex
      const current = device.host === currentDevice.host
      const name = truncate(device.name, compact ? 18 : 26)
      return Text({
        content: `${selected ? ">" : " "} ${current ? "●" : " "} ${name}`,
        fg: selected ? "#FFFFFF" : current ? "#C084FC" : "#D4D4D8",
        bg: selected ? "#7C3AED" : undefined,
      })
    }),
    Text({
      content: `${state.devices.length ? start + 1 : 0}-${Math.min(start + visibleCount, state.devices.length)} of ${state.devices.length}`,
      fg: "#8B8B93",
    }),
  )
}

function typingPanel(state: RemoteState, compact: boolean) {
  const text = state.typing ? `Type: ${state.typeBuffer}_` : "Press i to type on TV"
  return Box(
    {
      width: compact ? 24 : 28,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      backgroundColor: state.typing ? "#2A173F" : "#17171B",
    },
    Text({ content: text, fg: state.typing ? "#FFFFFF" : "#8B8B93" }),
  )
}

function footer(state: RemoteState, compact: boolean) {
  const content =
    state.view === "apps"
      ? "Apps: type to filter · Enter launch · Esc close"
      : state.view === "settings"
        ? "AI: up/down provider · Tab edit model · Enter save · Esc close"
      : state.view === "ask"
          ? "Ask: type request · Enter run · Esc close"
          : state.view === "tvs"
            ? "TVs: up/down choose · Enter switch · R refresh · Esc close"
      : compact
        ? "/ ask · A apps · T TVs · C AI · Q quit"
        : "/ ask · A apps · T TVs · C AI · Enter OK · +/- volume · 0 mute · O on · X off · Q quit"

  return Box(
    {
      width: compact ? 42 : 72,
      paddingX: 2,
      paddingY: 1,
      backgroundColor: "#0C0C0F",
    },
    Text({ content, fg: "#A1A1AA" }),
  )
}

function buttonRow(items: ReturnType<typeof pillButton>[]) {
  return Box({ flexDirection: "row", gap: 1, alignItems: "center" }, ...items)
}

function pillButton(label: string, key: string, variant: "purple" | "quiet", compact: boolean) {
  const width = compact ? 8 : label.length > 4 ? 11 : 9
  const bg = variant === "purple" ? "#7C3AED" : "#18181D"
  return Box(
    {
      width,
      backgroundColor: bg,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
    },
    Text({ content: compact ? label : `${label} ${key}`, fg: "#FFFFFF" }),
  )
}

function roundButton(label: string, key: string, compact: boolean) {
  const width = compact ? 8 : 9
  return Box(
    {
      width,
      backgroundColor: "#18181D",
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
      width: compact ? 24 : 28,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#17171B",
    },
    dpadRow([dpadSpacer(compact), dpadButton("▲", compact), dpadSpacer(compact)], compact),
    dpadRow([dpadButton("◀", compact), dpadButton("OK", compact, true), dpadButton("▶", compact)], compact),
    dpadRow([dpadSpacer(compact), dpadButton("▼", compact), dpadSpacer(compact)], compact),
  )
}

function dpadRow(items: ReturnType<typeof dpadButton>[], compact: boolean) {
  return Box({ flexDirection: "row", gap: compact ? 0 : 1, alignItems: "center" }, ...items)
}

function dpadButton(label: string, compact: boolean, primary = false) {
  return Box(
    {
      width: compact ? 6 : 7,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
      backgroundColor: primary ? "#25252B" : "#1F1F25",
    },
    Text({ content: label, fg: primary ? "#FFFFFF" : "#E4E4E7" }),
  )
}

function dpadSpacer(compact: boolean) {
  return Box({ width: compact ? 6 : 7 }, Text({ content: "" }))
}

function accentBar(compact: boolean) {
  return Box(
    {
      width: compact ? 20 : 24,
      height: 1,
      backgroundColor: "#7C3AED",
    },
    Text({ content: "", fg: "#7C3AED" }),
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
