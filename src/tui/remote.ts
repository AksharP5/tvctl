import { Box, Text, createCliRenderer, type KeyEvent } from "@opentui/core"
import { RokuClient } from "../roku/client"
import type { RokuApp, RokuDevice, RokuKey } from "../types"

interface RemoteState {
  activeApp?: RokuApp
  status: string
  typing: boolean
  typeBuffer: string
  lastKey?: string
}

export async function runRemote(device: RokuDevice): Promise<void> {
  const client = new RokuClient(device.host)
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  const state: RemoteState = {
    status: "Ready",
    typing: false,
    typeBuffer: "",
  }

  async function refresh(): Promise<void> {
    try {
      state.activeApp = await client.activeApp()
      state.status = "Connected"
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Unable to refresh"
    }
    draw()
  }

  function draw(): void {
    const existing = renderer.root.getRenderable("tvctl-root")
    if (existing) {
      renderer.root.remove("tvctl-root")
    }

    renderer.root.add(
      Box(
        {
          id: "tvctl-root",
          width: "100%",
          height: "100%",
          padding: 1,
          gap: 1,
          flexDirection: "column",
          backgroundColor: "#0D1117",
        },
        header(device, state),
        remotePad(state),
        typingPanel(state),
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
      return
    }

    switch (key.name) {
      case "escape":
      case "q":
        renderer.destroy()
        return
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
      borderColor: "#58A6FF",
      padding: 1,
      flexDirection: "column",
      gap: 1,
    },
    Text({ content: `tvctl · ${device.name}`, fg: "#F0F6FC" }),
    Text({ content: `Host: ${device.host}`, fg: "#8B949E" }),
    Text({ content: `Active: ${state.activeApp?.name ?? "unknown"}   Status: ${state.status}`, fg: "#A5D6FF" }),
  )
}

function remotePad(state: RemoteState) {
  const accent = "#7EE787"
  const muted = "#8B949E"
  const active = state.lastKey ? `Last key: ${state.lastKey}` : "Use arrow keys or hjkl"

  return Box(
    {
      borderStyle: "rounded",
      borderColor: "#30363D",
      padding: 1,
      flexDirection: "column",
      gap: 1,
    },
    Text({ content: "          Up", fg: accent }),
    Text({ content: "     Left  OK  Right", fg: accent }),
    Text({ content: "         Down", fg: accent }),
    Text({ content: "", fg: muted }),
    Text({ content: "Home(m)  Back(b)  Search(s)  Play(p)  Replay(r)", fg: "#F0F6FC" }),
    Text({ content: active, fg: muted }),
  )
}

function typingPanel(state: RemoteState) {
  const borderColor = state.typing ? "#F2CC60" : "#30363D"
  const text = state.typing
    ? `Typing: ${state.typeBuffer}_`
    : "Press i to type from your laptop keyboard into the TV."

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
    Text({ content: "Keys: arrows/hjkl move · Enter/Space OK · i type · F5 refresh · q/Esc quit", fg: "#8B949E" }),
    Text({ content: "CLI: tvctl apps · tvctl launch youtube · tvctl type \"search text\" · tvctl key Home", fg: "#8B949E" }),
  )
}
