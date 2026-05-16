import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { launchApp } from "../roku/apps"
import { RokuClient } from "../roku/client"
import type { RokuApp, RokuDevice, RokuKey } from "../types"

type ViewMode = "remote" | "apps"

interface RemoteState {
  activeApp?: RokuApp
  apps: RokuApp[]
  status: string
  view: ViewMode
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
    view: "remote",
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
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#080B10",
        },
        header(device, state),
        Box(
          {
            width: 48,
            flexGrow: 1,
            flexDirection: "column",
            justifyContent: "center",
          },
          state.view === "apps" ? appDrawer(state) : remoteBody(state),
        ),
        footer(state),
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
      if (state.view === "apps") {
        state.view = "remote"
        state.appFilter = ""
        state.selectedAppIndex = 0
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

    if (state.view === "apps") {
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
      width: "100%",
      borderStyle: "rounded",
      borderColor: "#1F6FEB",
      paddingX: 2,
      paddingY: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: "#0D1117",
    },
    Text({ content: `tvctl  ${device.name}`, fg: "#F0F6FC" }),
    Text({ content: `${state.activeApp?.name ?? "unknown"}  ·  ${state.status}`, fg: "#A5D6FF" }),
  )
}

function remoteBody(state: RemoteState) {
  return Box(
    {
      width: 48,
      borderStyle: "rounded",
      borderColor: "#30363D",
      paddingX: 4,
      paddingY: 2,
      gap: 1,
      flexDirection: "column",
      alignItems: "center",
      backgroundColor: "#101820",
      title: " Remote ",
      titleAlignment: "center",
    },
    buttonRow([button("Home", "m", "#2F81F7"), button("Back", "b", "#8B949E"), button("Apps", "a", "#F2CC60")]),
    spacer(),
    Text({ content: "          ▲", fg: "#7EE787" }),
    Text({ content: "      ◀  OK  ▶", fg: "#7EE787" }),
    Text({ content: "          ▼", fg: "#7EE787" }),
    spacer(),
    buttonRow([button("Search", "s", "#D2A8FF"), button("Play", "p", "#7EE787"), button("Replay", "r", "#FFA657")]),
    typingPanel(state),
    Text({ content: state.lastKey ? `Last: ${state.lastKey}` : "Use arrow keys or hjkl", fg: "#8B949E" }),
  )
}

function appDrawer(state: RemoteState) {
  const apps = filteredApps(state)
  const visibleApps = apps.slice(0, 12)
  const rows = visibleApps.map((app, index) => {
    const selected = index === state.selectedAppIndex
    const label = app.name.padEnd(32).slice(0, 32)
    return Text({
      content: `${selected ? ">" : " "} ${label}`,
      fg: selected ? "#0B0F14" : "#D0D7DE",
      bg: selected ? "#F2CC60" : undefined,
    })
  })

  return Box(
    {
      width: 48,
      borderStyle: "rounded",
      borderColor: "#F2CC60",
      paddingX: 3,
      paddingY: 2,
      gap: 1,
      flexDirection: "column",
      backgroundColor: "#101820",
      title: " Apps ",
      titleAlignment: "center",
    },
    Text({ content: "Type to filter. Enter launches. Esc closes.", fg: "#F2CC60" }),
    Text({ content: state.appFilter ? `Filter: ${state.appFilter}_` : "Filter: _", fg: "#8B949E" }),
    ...rows,
    Text({ content: `${apps.length} matching apps`, fg: "#8B949E" }),
  )
}

function typingPanel(state: RemoteState) {
  const text = state.typing ? `Type: ${state.typeBuffer}_` : "Press i to type on TV"
  return Box(
    {
      width: 34,
      borderStyle: "rounded",
      borderColor: state.typing ? "#F2CC60" : "#30363D",
      paddingX: 1,
      paddingY: 1,
      marginTop: 1,
    },
    Text({ content: text, fg: state.typing ? "#F2CC60" : "#8B949E" }),
  )
}

function footer(state: RemoteState) {
  const content =
    state.view === "apps"
      ? "Apps: type to filter · Enter launch · Esc close"
      : "Remote: arrows move · Enter OK · A apps · I type · Q quit"

  return Box(
    {
      width: "100%",
      borderStyle: "rounded",
      borderColor: "#30363D",
      paddingX: 2,
      paddingY: 1,
      backgroundColor: "#0D1117",
    },
    Text({ content, fg: "#8B949E" }),
  )
}

function buttonRow(items: ReturnType<typeof button>[]) {
  return Box({ flexDirection: "row", gap: 1 }, ...items)
}

function button(label: string, key: string, color: string) {
  return Box(
    {
      width: 11,
      borderStyle: "rounded",
      borderColor: color,
      paddingX: 1,
      paddingY: 1,
      alignItems: "center",
    },
    Text({ content: `${label} ${key}`, fg: color }),
  )
}

function spacer() {
  return Text({ content: "", fg: "#8B949E" })
}

function filteredApps(state: RemoteState): RokuApp[] {
  const query = state.appFilter.toLowerCase().trim()
  if (!query) return state.apps
  return state.apps.filter((app) => app.name.toLowerCase().includes(query) || app.id.toLowerCase().includes(query))
}
