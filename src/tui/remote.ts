import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { launchApp } from "../roku/apps"
import { RokuClient } from "../roku/client"
import type { RokuApp, RokuDevice, RokuKey } from "../types"

type FocusPane = "remote" | "apps"

interface RemoteState {
  activeApp?: RokuApp
  apps: RokuApp[]
  status: string
  focus: FocusPane
  typing: boolean
  typeBuffer: string
  appFilter: string
  selectedAppIndex: number
  lastKey?: string
}

export async function runRemote(device: RokuDevice): Promise<void> {
  const client = new RokuClient(device.host)
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  const state: RemoteState = {
    apps: [],
    status: "Connecting",
    focus: "remote",
    typing: false,
    typeBuffer: "",
    appFilter: "",
    selectedAppIndex: 0,
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

    renderer.root.add(
      Box(
        {
          id: "tvctl-root",
          width: "100%",
          height: "100%",
          padding: 1,
          gap: 1,
          flexDirection: "column",
          backgroundColor: "#0B0F14",
        },
        header(device, state),
        Box(
          {
            flexGrow: 1,
            gap: 1,
            flexDirection: "row",
          },
          Box(
            {
              width: "50%",
              flexDirection: "column",
              gap: 1,
            },
            remotePad(state),
            typingPanel(state),
          ),
          appPanel(state),
        ),
        helpPanel(),
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

    if (key.name === "escape" || key.name === "q") {
      renderer.destroy()
      return
    }

    if (key.name === "tab") {
      state.focus = state.focus === "remote" ? "apps" : "remote"
      state.status = state.focus === "apps" ? "App launcher" : "Remote"
      draw()
      return
    }

    if (state.focus === "apps") {
      await handleAppKey(key)
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
      case "r":
        await sendKey("InstantReplay")
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
      borderStyle: "rounded",
      borderColor: "#2F81F7",
      padding: 1,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    Text({ content: `tvctl  ${device.name}`, fg: "#F0F6FC" }),
    Text({ content: `Active: ${state.activeApp?.name ?? "unknown"}  |  ${state.status}`, fg: "#A5D6FF" }),
  )
}

function remotePad(state: RemoteState) {
  const focused = state.focus === "remote"
  const borderColor = focused ? "#7EE787" : "#30363D"
  const active = state.lastKey ? `Last key: ${state.lastKey}` : "Arrow keys or hjkl"

  return Box(
    {
      borderStyle: "rounded",
      borderColor,
      padding: 1,
      flexDirection: "column",
      gap: 1,
      flexGrow: 1,
      title: focused ? " Remote " : " Remote",
    },
    Text({ content: "             Up", fg: "#7EE787" }),
    Text({ content: "       Left   OK   Right", fg: "#7EE787" }),
    Text({ content: "            Down", fg: "#7EE787" }),
    Text({ content: "", fg: "#8B949E" }),
    Text({ content: "Home m     Back b     Search s", fg: "#F0F6FC" }),
    Text({ content: "Play p     Replay r   Type i", fg: "#F0F6FC" }),
    Text({ content: active, fg: "#8B949E" }),
  )
}

function appPanel(state: RemoteState) {
  const apps = filteredApps(state)
  const visibleApps = apps.slice(0, 14)
  const focused = state.focus === "apps"
  const rows = visibleApps.map((app, index) => {
    const selected = index === state.selectedAppIndex
    const marker = selected ? ">" : " "
    const id = app.type === "tvin" ? "input" : app.id
    return Text({
      content: `${marker} ${app.name.padEnd(30).slice(0, 30)} ${id}`,
      fg: selected ? "#0B0F14" : "#D0D7DE",
      bg: selected ? "#F2CC60" : undefined,
    })
  })

  return Box(
    {
      borderStyle: "rounded",
      borderColor: focused ? "#F2CC60" : "#30363D",
      padding: 1,
      flexDirection: "column",
      gap: 1,
      flexGrow: 1,
      title: focused ? " Apps " : " Apps",
    },
    Text({
      content: state.appFilter ? `Filter: ${state.appFilter}_` : "Type to filter apps",
      fg: focused ? "#F2CC60" : "#8B949E",
    }),
    ...rows,
    Text({ content: `${apps.length} apps · Enter launches selected app`, fg: "#8B949E" }),
  )
}

function typingPanel(state: RemoteState) {
  const borderColor = state.typing ? "#F2CC60" : "#30363D"
  const text = state.typing ? `Typing to TV: ${state.typeBuffer}_` : "Press i, type text, Enter sends it to the TV."

  return Box(
    {
      borderStyle: "rounded",
      borderColor,
      padding: 1,
    },
    Text({ content: text, fg: state.typing ? "#F2CC60" : "#8B949E" }),
  )
}

function helpPanel() {
  return Box(
    {
      borderStyle: "rounded",
      borderColor: "#30363D",
      padding: 1,
      flexDirection: "column",
    },
    Text({ content: "Tab switches panes · q quits · F5 refreshes · Apps pane: type to filter, Enter to launch", fg: "#8B949E" }),
    Text({ content: 'Shortcuts: tvctl youtube search drake album · tvctl netflix · tvctl launch "Prime Video"', fg: "#8B949E" }),
  )
}

function filteredApps(state: RemoteState): RokuApp[] {
  const query = state.appFilter.toLowerCase().trim()
  if (!query) return state.apps
  return state.apps.filter((app) => app.name.toLowerCase().includes(query) || app.id.toLowerCase().includes(query))
}
