import { Box, MouseButton, Text, createCliRenderer, type BoxOptions, type KeyEvent, type MouseEvent, type VChild } from "@opentui/core"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { defaultAiConfig, executePlan, planTvRequest } from "../ai"
import { getAiConfig, setAiConfig, setDefaultDevice } from "../config"
import { launchApp } from "../roku/apps"
import { RokuClient } from "../roku/client"
import { discoverRokus } from "../roku/discover"
import type { RokuApp, RokuDevice, RokuKey, TvctlAiProvider } from "../types"
import { loadProviderModels, providers } from "./model"

const execFileAsync = promisify(execFile)

type ViewMode = "remote" | "apps" | "settings" | "ask" | "tvs"
type ClickHandler = () => void | Promise<void>

interface FooterAction {
  label: string
  onClick: ClickHandler
}

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
  selectedModelIndex: number
  providerModels: Partial<Record<TvctlAiProvider, string[]>>
  modelsLoading: boolean
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
  let askAbortController: AbortController | undefined
  const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true })
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
    selectedModelIndex: modelIndexFor(providerIndex, aiConfig?.model ?? defaultAiConfig.model),
    providerModels: { [providers[providerIndex]?.id ?? "opencode"]: providers[providerIndex]?.suggestions ?? [] },
    modelsLoading: false,
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
            width: state.view === "settings" ? (compact ? 58 : 76) : compact ? 32 : 42,
            flexDirection: "column",
            alignItems: "center",
          },
          state.view === "apps"
            ? appDrawer(state, compact, async (index) => {
                state.selectedAppIndex = index
                await launchSelectedApp()
              })
            : state.view === "settings"
              ? settingsPanel(state, compact, {
                  chooseProvider: async (index) => {
                    state.providerIndex = index
                    state.selectedModelIndex = 0
                    state.aiModel = selectedProviderModel(state)
                    draw()
                    void refreshProviderModels()
                    await refreshProviderStatus()
                  },
                  chooseModel: (index) => {
                    state.selectedModelIndex = index
                    state.aiModel = selectedProviderModel(state)
                    state.editingModel = false
                    state.providerStatus = "Save to check provider"
                    state.providerStatusOk = false
                    draw()
                  },
                  toggleModelEdit: () => {
                    state.editingModel = !state.editingModel
                    draw()
                  },
                  saveSettings: handleSaveSettings,
                  back: closeOverlay,
                })
              : state.view === "ask"
                ? askPanel(state, compact, handleAskSubmit)
                : state.view === "tvs"
                  ? tvPanel(state, currentDevice, compact, async (index) => {
                      state.selectedDeviceIndex = index
                      await switchDevice()
                    })
                  : remoteBody(state, compact, {
                      ask: openAsk,
                      apps: openApps,
                      settings: openSettings,
                      tvs: openTvs,
                      type: openTyping,
                      refresh,
                      sendKey,
                    }),
        ),
        footer(state, compact, footerActions()),
      ),
    )
  }

  function footerActions(): FooterAction[] {
    if (state.view === "apps") {
      return [
        { label: "Up", onClick: () => moveSelectedApp(-1) },
        { label: "Down", onClick: () => moveSelectedApp(1) },
        { label: "Enter", onClick: launchSelectedApp },
        { label: "Back", onClick: closeOverlay },
      ]
    }
    if (state.view === "settings") {
      return [
        { label: "Provider-", onClick: () => chooseSettingsProvider(-1) },
        { label: "Provider+", onClick: () => chooseSettingsProvider(1) },
        { label: "Up", onClick: () => moveSettingsModel(-1) },
        { label: "Down", onClick: () => moveSettingsModel(1) },
        { label: "Save", onClick: handleSaveSettings },
        { label: "Back", onClick: closeOverlay },
      ]
    }
    if (state.view === "ask") {
      return [
        { label: "Enter", onClick: handleAskSubmit },
        { label: state.askBusy ? "Cancel" : "Back", onClick: closeOverlay },
      ]
    }
    if (state.view === "tvs") {
      return [
        { label: "Up", onClick: () => moveSelectedDevice(-1) },
        { label: "Down", onClick: () => moveSelectedDevice(1) },
        { label: "Enter", onClick: switchDevice },
        { label: "Refresh", onClick: refreshDevices },
        { label: "Back", onClick: closeOverlay },
      ]
    }
    return [
      { label: "Ask", onClick: openAsk },
      { label: "Apps", onClick: openApps },
      { label: "TVs", onClick: openTvs },
      { label: "AI", onClick: openSettings },
      { label: "Quit", onClick: () => renderer.destroy() },
    ]
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

  function moveSelectedDevice(delta: number): void {
    state.selectedDeviceIndex = Math.max(0, Math.min(Math.max(0, state.devices.length - 1), state.selectedDeviceIndex + delta))
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

  function moveSelectedApp(delta: number): void {
    const apps = filteredApps(state)
    state.selectedAppIndex = Math.max(0, Math.min(Math.max(0, apps.length - 1), state.selectedAppIndex + delta))
    draw()
  }

  function chooseSettingsProvider(delta: number): void {
    state.providerIndex = Math.max(0, Math.min(providers.length - 1, state.providerIndex + delta))
    state.selectedModelIndex = 0
    state.aiModel = selectedProviderModel(state)
    draw()
    void refreshProviderModels()
    void refreshProviderStatus()
  }

  function moveSettingsModel(delta: number): void {
    const models = currentProviderModels(state)
    state.selectedModelIndex = Math.max(0, Math.min(Math.max(0, models.length - 1), state.selectedModelIndex + delta))
    state.aiModel = models[state.selectedModelIndex] ?? state.aiModel
    state.editingModel = false
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

  function openApps(): void {
    state.view = "apps"
    state.status = "Choose an app"
    draw()
  }

  function openAsk(): void {
    state.view = "ask"
    state.askBuffer = ""
    state.status = "Ask tvctl"
    draw()
    void refreshProviderStatus()
  }

  function openSettings(): void {
    state.view = "settings"
    state.editingModel = false
    state.selectedModelIndex = modelIndexFor(state.providerIndex, state.aiModel)
    state.status = "AI settings"
    draw()
    void refreshProviderModels()
    void refreshProviderStatus()
  }

  async function refreshProviderModels(): Promise<void> {
    const provider = providers[state.providerIndex] ?? providers[0]!
    state.modelsLoading = true
    draw()
    const models = await loadProviderModels(provider)
    state.providerModels[provider.id] = models
    if (!models.includes(state.aiModel)) {
      state.selectedModelIndex = 0
      state.aiModel = models[0] ?? state.aiModel
    } else {
      state.selectedModelIndex = modelIndexForList(models, state.aiModel)
    }
    state.modelsLoading = false
    draw()
  }

  function closeOverlay(): void {
    if (state.view === "ask" && state.askBusy) {
      askAbortController?.abort()
      state.askBusy = false
      state.status = "Ask canceled"
      draw()
      return
    }
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
  }

  function openTvs(): void {
    state.view = "tvs"
    state.status = "Choose a TV"
    draw()
    void refreshDevices()
  }

  function openTyping(): void {
    state.typing = true
    state.typeBuffer = ""
    state.status = "Typing mode"
    draw()
  }

  async function handleKey(key: KeyEvent): Promise<void> {
    if (state.typing) {
      await handleTypingKey(key)
      return
    }

    if (key.name === "q" || key.name === "escape") {
      closeOverlay()
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
      openApps()
      return
    }

    if (key.name === "/") {
      openAsk()
      return
    }

    if (key.name === "c") {
      openSettings()
      return
    }

    if (key.name === "t") {
      openTvs()
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
      await handleAskSubmit()
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
      await handleSaveSettings()
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
        state.selectedModelIndex = modelIndexFor(state.providerIndex, state.aiModel)
        state.providerStatus = "Save to check provider"
        state.providerStatusOk = false
        draw()
      }
      return
    }

    if (key.name === "left" || key.name === "h") {
      state.providerIndex = Math.max(0, state.providerIndex - 1)
      state.selectedModelIndex = 0
      state.aiModel = selectedProviderModel(state)
      draw()
      void refreshProviderModels()
      void refreshProviderStatus()
      return
    }
    if (key.name === "right" || key.name === "l") {
      state.providerIndex = Math.min(providers.length - 1, state.providerIndex + 1)
      state.selectedModelIndex = 0
      state.aiModel = selectedProviderModel(state)
      draw()
      void refreshProviderModels()
      void refreshProviderStatus()
      return
    }
    if (key.name === "up" || key.name === "k") {
      const options = currentProviderModels(state)
      state.selectedModelIndex = Math.max(0, state.selectedModelIndex - 1)
      state.aiModel = options[state.selectedModelIndex] ?? state.aiModel
      state.editingModel = false
      draw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      const options = currentProviderModels(state)
      state.selectedModelIndex = Math.min(Math.max(0, options.length - 1), state.selectedModelIndex + 1)
      state.aiModel = options[state.selectedModelIndex] ?? state.aiModel
      state.editingModel = false
      draw()
      return
    }
    if (key.name === "e") {
      state.editingModel = true
      draw()
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
        openTyping()
        return
      case "f5":
        await refresh()
        return
    }
  }

  draw()
  await refresh()

  async function handleAskSubmit(): Promise<void> {
    if (state.askBusy) return
    const request = state.askBuffer.trim()
    if (!request) return

    state.askBusy = true
    state.status = `Planning: ${request}`
    draw()
    try {
      if (state.apps.length === 0) {
        state.apps = await client.apps()
      }
      if (!state.activeApp) {
        state.activeApp = await client.activeApp()
      }

      const provider = providers[state.providerIndex] ?? providers[0]!
      askAbortController = new AbortController()
      const result = await planTvRequest(
        request,
        state.apps,
        state.activeApp,
        { provider: provider.id, model: state.aiModel.trim() || undefined },
        undefined,
        { signal: askAbortController.signal },
      )
      askAbortController = undefined
      const plannerLabel = result.source === "ai" ? "AI" : result.fallbackReason ? "local fallback" : "local"
      state.status = `${result.plan.summary} (${plannerLabel})`
      draw()
      await executePlan(client, state.apps, result.plan)
      state.status = `Done: ${result.plan.summary}`
      state.askBuffer = ""
      state.askBusy = false
      await refresh()
      state.view = "ask"
      state.status = `Done: ${result.plan.summary}`
      draw()
    } catch (error) {
      askAbortController = undefined
      state.status = error instanceof Error ? error.message : "Ask failed"
      state.askBusy = false
      draw()
    }
  }

  async function handleSaveSettings(): Promise<void> {
    const provider = providers[state.providerIndex] ?? providers[0]!
    const model = state.aiModel.trim()
    await setAiConfig({ provider: provider.id, model: model || undefined })
    state.status = `Saved ${provider.label}${model ? ` / ${model}` : ""}`
    state.editingModel = false
    draw()
    void refreshProviderStatus()
  }
}

function header(device: RokuDevice, state: RemoteState) {
  const width = 60
  return Box(
    {
      width,
      paddingX: 1,
      flexDirection: "column",
      alignItems: "center",
    },
    Text({ content: "tvctl", fg: "#8B5CF6" }),
    Text({ content: fitLine(`${device.name}  ·  ${state.activeApp?.name ?? "unknown"}`, width - 2), fg: "#F4F4F5" }),
    Text({ content: fitLine(state.status, width - 2), fg: "#8B8B93" }),
  )
}

function compactHeader(device: RokuDevice, state: RemoteState) {
  const width = 36
  return Box(
    { width, flexDirection: "column", alignItems: "center" },
    Text({ content: fitLine(device.name, width), fg: "#F4F4F5" }),
    Text({ content: fitLine(`${state.activeApp?.name ?? "unknown"} · ${state.status}`, width), fg: "#8B8B93" }),
  )
}

interface RemoteActions {
  ask: ClickHandler
  apps: ClickHandler
  settings: ClickHandler
  tvs: ClickHandler
  type: ClickHandler
  refresh: ClickHandler
  sendKey: (key: RokuKey) => Promise<void>
}

interface SettingsActions {
  chooseProvider: (index: number) => void | Promise<void>
  chooseModel: (index: number) => void | Promise<void>
  toggleModelEdit: ClickHandler
  saveSettings: ClickHandler
  back: ClickHandler
}

function remoteBody(state: RemoteState, compact: boolean, actions: RemoteActions) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return Box(
    {
      width: compact ? 30 : 36,
      height: compact ? 32 : 42,
      paddingX: compact ? 2 : 3,
      paddingY: compact ? 0 : 1,
      gap: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#0C0C0F",
    },
    accentBar(compact),
    Text({ content: "tvctl remote", fg: "#F4F4F5" }),
    buttonRow([pillButton("ON", "o", "quiet", compact, () => actions.sendKey("PowerOn")), pillButton("OFF", "x", "quiet", compact, () => actions.sendKey("PowerOff"))]),
    sectionGap(compact),
    buttonRow([pillButton("HOME", "m", "primary", compact, () => actions.sendKey("Home")), pillButton("BACK", "b", "quiet", compact, () => actions.sendKey("Back"))]),
    sectionGap(compact),
    dpad(compact, actions),
    sectionGap(compact),
    buttonRow([pillButton("ASK", "/", "primary", compact, actions.ask), pillButton("APPS", "a", "primary", compact, actions.apps)]),
    buttonRow([pillButton("TVS", "t", "quiet", compact, actions.tvs), pillButton("AI", "c", "quiet", compact, actions.settings)]),
    sectionGap(compact),
    buttonRow([
      roundButton("VOL+", "+", compact, () => actions.sendKey("VolumeUp")),
      roundButton("MUTE", "0", compact, () => actions.sendKey("VolumeMute")),
      roundButton("VOL-", "-", compact, () => actions.sendKey("VolumeDown")),
    ]),
    sectionGap(compact),
    buttonRow([
      pillButton("REW", "[", "quiet", compact, () => actions.sendKey("Rev")),
      pillButton("PLAY", "p", "quiet", compact, () => actions.sendKey("Play")),
      pillButton("FWD", "]", "quiet", compact, () => actions.sendKey("Fwd")),
    ]),
    buttonRow([
      pillButton("SEARCH", "s", "quiet", compact, () => actions.sendKey("Search")),
      pillButton("INFO", "?", "quiet", compact, () => actions.sendKey("Info")),
      pillButton("REPLAY", "r", "quiet", compact, () => actions.sendKey("InstantReplay")),
    ]),
    sectionGap(compact),
    typingPanel(state, compact, actions.type),
    Text({ content: `AI ${provider.label}`, fg: "#8B8B93" }),
    Text({ content: state.lastKey ? `Last ${state.lastKey}` : "arrows / hjkl move", fg: "#8B8B93" }),
  )
}

function appDrawer(state: RemoteState, compact: boolean, onLaunch: (index: number) => void | Promise<void>) {
  const apps = filteredApps(state)
  const visibleCount = compact ? 9 : 12
  const start = Math.max(0, Math.min(state.selectedAppIndex - Math.floor(visibleCount / 2), Math.max(0, apps.length - visibleCount)))
  const visibleApps = apps.slice(start, start + visibleCount)
  const rows = visibleApps.map((app, offset) => {
    const index = start + offset
    const selected = index === state.selectedAppIndex
    const labelWidth = compact ? 22 : 30
    const label = app.name.padEnd(labelWidth).slice(0, labelWidth)
    return clickable(
      () => onLaunch(index),
      { width: compact ? 26 : 34, backgroundColor: selected ? "#27272F" : undefined },
      Text({
        content: `${selected ? ">" : " "} ${label}`,
        fg: selected ? "#FFFFFF" : "#D4D4D8",
      }),
    )
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
    Text({ content: state.appFilter ? fitLine(`filter ${state.appFilter}_`, compact ? 26 : 34) : "type to filter", fg: "#8B8B93" }),
    ...rows,
    Text({ content: fitLine(`${apps.length ? start + 1 : 0}-${Math.min(start + visibleCount, apps.length)} of ${apps.length} · Enter launches`, compact ? 26 : 34), fg: "#8B8B93" }),
  )
}

function settingsPanel(state: RemoteState, compact: boolean, actions: SettingsActions) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  const panelWidth = compact ? 58 : 76
  const leftWidth = compact ? 18 : 22
  const rightWidth = compact ? 34 : 48
  const currentModel = state.aiModel || selectedProviderModel(state)
  const models = currentProviderModels(state)
  const modelCount = compact ? 8 : 10
  const modelRows = visibleModelRows(models, state.selectedModelIndex, modelCount).map(({ item: model, index }) => {
    const selected = model === currentModel
    return clickable(
      () => actions.chooseModel(index),
      {
        width: rightWidth,
        height: 1,
        backgroundColor: selected ? "#2B2B33" : undefined,
        paddingX: 1,
      },
      Text({
        content: `${selected ? ">" : " "} ${middleEllipsis(model, rightWidth - 4)}`,
        fg: selected ? "#FFFFFF" : "#D4D4D8",
      }),
    )
  })
  return Box(
    {
      width: panelWidth,
      height: compact ? 30 : 36,
      paddingX: 2,
      paddingY: 1,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#0C0C0F",
    },
    Box(
      { width: panelWidth - 4, flexDirection: "row", justifyContent: "space-between" },
      Text({ content: "AI settings", fg: "#F4F4F5" }),
      Text({ content: `${models.length ? state.selectedModelIndex + 1 : 0}/${models.length}`, fg: "#8B8B93" }),
    ),
    Text({
      content: fitLine(state.modelsLoading ? `Loading ${provider.label} models...` : state.providerStatus, panelWidth - 4),
      fg: state.modelsLoading ? "#A1A1AA" : state.providerStatusOk ? "#86EFAC" : "#FCA5A5",
    }),
    Box(
      { width: panelWidth - 4, flexDirection: "row", gap: 2, alignItems: "flex-start" },
      Box(
        { width: leftWidth, height: compact ? 17 : 21, flexDirection: "column", gap: 1 },
        Text({ content: "Provider", fg: "#A1A1AA" }),
        ...providers.map((item, index) =>
          clickable(
            () => actions.chooseProvider(index),
            { width: leftWidth, height: 1, backgroundColor: index === state.providerIndex ? "#2B2B33" : undefined, paddingX: 1 },
            Text({
              content: `${index === state.providerIndex ? ">" : " "} ${fitLine(item.label, leftWidth - 3)}`,
              fg: index === state.providerIndex ? "#FFFFFF" : "#D4D4D8",
            }),
          ),
        ),
        Text({ content: "Controls", fg: "#A1A1AA" }),
        smallAction("Back", actions.back, compact),
        smallAction("Save", actions.saveSettings, compact),
        smallAction("Custom", actions.toggleModelEdit, compact),
      ),
      Box(
        { width: rightWidth, height: compact ? 17 : 21, flexDirection: "column", gap: 1 },
        Text({ content: "Model", fg: "#A1A1AA" }),
        ...modelRows,
        Box(
          {
            width: rightWidth,
            height: compact ? 3 : 4,
            backgroundColor: state.editingModel ? "#2A173F" : "#17171B",
            paddingX: 1,
            paddingY: 0,
            onMouseUp: clickHandler(actions.toggleModelEdit),
          },
          Text({
            content: state.editingModel
              ? wrapInput(`Custom: ${state.aiModel}_`, rightWidth - 2, compact ? 2 : 3)
              : wrapInput(`Selected: ${currentModel}`, rightWidth - 2, compact ? 2 : 3),
            fg: state.editingModel ? "#FFFFFF" : "#D4D4D8",
          }),
        ),
      ),
    ),
    ...textBlock(provider.setupHint, panelWidth - 4, 2, "#8B8B93"),
  )
}

function askPanel(state: RemoteState, compact: boolean, onSubmit: ClickHandler) {
  const provider = providers[state.providerIndex] ?? providers[0]!
  const innerWidth = compact ? 26 : 34
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
    ...textBlock(`Using ${provider.label} / ${state.aiModel}`, innerWidth, 2, "#C084FC"),
    Text({ content: fitLine(state.providerStatus, innerWidth), fg: state.providerStatusOk ? "#86EFAC" : "#FCA5A5" }),
    Box(
      {
        width: innerWidth,
        height: compact ? 5 : 7,
        backgroundColor: state.askBusy ? "#2A173F" : "#17171B",
        paddingX: 1,
        paddingY: 1,
      },
      Text({
        content: wrapInput(`${state.askBuffer}${state.askBusy ? "" : "_"}`, compact ? 22 : 30, compact ? 3 : 5),
        fg: "#FFFFFF",
      }),
    ),
    clickable(onSubmit, { width: innerWidth, backgroundColor: state.askBusy ? "#2A173F" : "#27272F", paddingX: 1 }, Text({ content: state.askBusy ? "Running..." : "Run request", fg: "#FFFFFF" })),
    Text({ content: "Examples", fg: "#A1A1AA" }),
    Text({ content: "search for drake album reactions", fg: "#D4D4D8" }),
    Text({ content: "open youtube and search trailers", fg: "#D4D4D8" }),
    Text({ content: fitLine(state.askBusy ? "Working on TV request" : "Enter run · Ctrl+U clear · Esc remote", innerWidth), fg: "#8B8B93" }),
  )
}

function tvPanel(state: RemoteState, currentDevice: RokuDevice, compact: boolean, onSwitch: (index: number) => void | Promise<void>) {
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
    Text({ content: fitLine("Enter switches · R refreshes", compact ? 26 : 34), fg: "#8B8B93" }),
    ...visibleDevices.map((device, offset) => {
      const index = start + offset
      const selected = index === state.selectedDeviceIndex
      const current = device.host === currentDevice.host
      const name = fitLine(device.name, compact ? 18 : 26)
      return clickable(
        () => onSwitch(index),
        { width: compact ? 26 : 34, backgroundColor: selected ? "#27272F" : undefined },
        Text({
          content: `${selected ? ">" : " "} ${current ? "*" : " "} ${name}`,
          fg: selected ? "#FFFFFF" : current ? "#C084FC" : "#D4D4D8",
        }),
      )
    }),
    Text({
      content: `${state.devices.length ? start + 1 : 0}-${Math.min(start + visibleCount, state.devices.length)} of ${state.devices.length}`,
      fg: "#8B8B93",
    }),
  )
}

function typingPanel(state: RemoteState, compact: boolean, onClick: ClickHandler) {
  const text = state.typing ? `Type: ${state.typeBuffer}_` : "Press i to type on TV"
  return Box(
    {
      width: compact ? 24 : 28,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      backgroundColor: state.typing ? "#2A173F" : "#17171B",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: state.typing ? wrapInput(text, compact ? 22 : 26, compact ? 2 : 3) : text, fg: state.typing ? "#FFFFFF" : "#8B8B93" }),
  )
}

function footer(state: RemoteState, compact: boolean, actions: FooterAction[]) {
  const content =
    state.view === "apps"
      ? "Apps"
      : state.view === "settings"
        ? "AI settings"
      : state.view === "ask"
          ? "Ask"
          : state.view === "tvs"
            ? "TVs"
      : compact
        ? "Remote"
        : "Remote"

  return Box(
    {
      width: compact ? 42 : 72,
      paddingX: 2,
      paddingY: 1,
      gap: 1,
      flexDirection: "row",
      backgroundColor: "#0C0C0F",
    },
    Text({ content: fitLine(content, compact ? 8 : 12), fg: "#A1A1AA" }),
    ...actions.map((action) => footerChip(action.label, action.onClick, compact)),
  )
}

function buttonRow(items: ReturnType<typeof pillButton>[]) {
  return Box({ flexDirection: "row", gap: 2, alignItems: "center" }, ...items)
}

function pillButton(label: string, key: string, variant: "primary" | "quiet", compact: boolean, onClick: ClickHandler) {
  const width = compact ? 8 : label.length > 4 ? 11 : 9
  const bg = variant === "primary" ? "#3B2D5F" : "#18181D"
  return Box(
    {
      width,
      backgroundColor: bg,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: compact ? label : `${label} ${key}`, fg: "#FFFFFF" }),
  )
}

function roundButton(label: string, key: string, compact: boolean, onClick: ClickHandler) {
  const width = compact ? 8 : 9
  return Box(
    {
      width,
      backgroundColor: "#18181D",
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: compact ? label : `${label} ${key}`, fg: "#FFFFFF" }),
  )
}

function smallAction(label: string, onClick: ClickHandler, compact: boolean) {
  return Box(
    {
      width: compact ? 8 : 10,
      backgroundColor: "#27272F",
      paddingX: 1,
      paddingY: 0,
      alignItems: "center",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: label, fg: "#FFFFFF" }),
  )
}

function footerChip(label: string, onClick: ClickHandler, compact: boolean) {
  return Box(
    {
      width: compact ? 8 : Math.min(12, Math.max(6, label.length + 2)),
      backgroundColor: "#1F1F25",
      paddingX: 1,
      alignItems: "center",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: fitLine(label, compact ? 6 : 10), fg: "#FFFFFF" }),
  )
}

function dpad(compact: boolean, actions: RemoteActions) {
  return Box(
    {
      width: compact ? 24 : 28,
      paddingX: 1,
      paddingY: compact ? 0 : 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#17171B",
    },
    dpadRow([dpadSpacer(compact), dpadButton("UP", compact, () => actions.sendKey("Up")), dpadSpacer(compact)], compact),
    dpadRow([
      dpadButton("LEFT", compact, () => actions.sendKey("Left")),
      dpadButton("OK", compact, () => actions.sendKey("Select"), true),
      dpadButton("RIGHT", compact, () => actions.sendKey("Right")),
    ], compact),
    dpadRow([dpadSpacer(compact), dpadButton("DOWN", compact, () => actions.sendKey("Down")), dpadSpacer(compact)], compact),
  )
}

function dpadRow(items: ReturnType<typeof dpadButton>[], compact: boolean) {
  return Box({ flexDirection: "row", gap: compact ? 1 : 2, alignItems: "center" }, ...items)
}

function dpadButton(label: string, compact: boolean, onClick: ClickHandler, primary = false) {
  return Box(
    {
      width: compact ? 6 : 7,
      paddingY: compact ? 0 : 1,
      alignItems: "center",
      backgroundColor: primary ? "#25252B" : "#1F1F25",
      onMouseUp: clickHandler(onClick),
    },
    Text({ content: compact ? shortDpadLabel(label) : label, fg: primary ? "#FFFFFF" : "#E4E4E7" }),
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

function sectionGap(compact: boolean) {
  return compact ? Text({ content: "" }) : Box({ height: 1 }, Text({ content: "" }))
}

function filteredApps(state: RemoteState): RokuApp[] {
  const query = state.appFilter.toLowerCase().trim()
  if (!query) return state.apps
  return state.apps.filter((app) => app.name.toLowerCase().includes(query) || app.id.toLowerCase().includes(query))
}

function selectedProviderModel(state: RemoteState): string {
  const models = currentProviderModels(state)
  return models[state.selectedModelIndex] ?? models[0] ?? state.aiModel
}

function modelIndexFor(providerIndex: number, model?: string): number {
  const suggestions = providers[providerIndex]?.suggestions ?? []
  return modelIndexForList(suggestions, model)
}

function modelIndexForList(suggestions: string[], model?: string): number {
  const index = suggestions.findIndex((item) => item === model)
  return index >= 0 ? index : 0
}

function currentProviderModels(state: RemoteState): string[] {
  const provider = providers[state.providerIndex] ?? providers[0]!
  return state.providerModels[provider.id] ?? provider.suggestions
}

function visibleModelRows(models: string[], selectedIndex: number, count: number): Array<{ item: string; index: number }> {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(count / 2), Math.max(0, models.length - count)))
  return models.slice(start, start + count).map((item, offset) => ({ item, index: start + offset }))
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

function textBlock(value: string, width: number, maxLines: number, fg: string) {
  return wrapWords(value, width)
    .slice(0, maxLines)
    .map((line) => Text({ content: line, fg }))
}

function wrapInput(value: string, width: number, maxLines: number): string {
  const lines = wrapWords(value, width)
  if (lines.length <= maxLines) return padLines(lines, maxLines).join("\n")

  const visible = lines.slice(lines.length - maxLines)
  visible[0] = fitLine(`...${visible[0]}`, width)
  return visible.join("\n")
}

function wrapWords(value: string, width: number): string[] {
  const normalized = value.replace(/\s+/g, " ")
  if (!normalized) return [""]

  const lines: string[] = []
  let line = ""
  for (const word of normalized.split(" ")) {
    if (!word) continue
    if (word.length > width) {
      if (line) {
        lines.push(line)
        line = ""
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width))
      }
      continue
    }

    const next = line ? `${line} ${word}` : word
    if (next.length > width) {
      lines.push(line)
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

function clickable(onClick: ClickHandler, options: BoxOptions, ...children: VChild[]) {
  return Box({ ...options, onMouseUp: clickHandler(onClick) }, ...children)
}

function clickHandler(onClick: ClickHandler) {
  return (event: MouseEvent): void => {
    if (event.button !== MouseButton.LEFT) return
    event.stopPropagation()
    void onClick()
  }
}

function shortDpadLabel(label: string): string {
  switch (label) {
    case "UP":
      return "^"
    case "DOWN":
      return "v"
    case "LEFT":
      return "<"
    case "RIGHT":
      return ">"
    default:
      return label
  }
}
