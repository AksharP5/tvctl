export interface RokuDevice {
  id: string
  name: string
  host: string
  location?: string
  model?: string
  serialNumber?: string
}

export interface RokuApp {
  id: string
  name: string
  type?: string
  version?: string
}

export interface TvctlConfig {
  defaultDevice?: RokuDevice
  ai?: TvctlAiConfig
}

export type TvctlAiProvider = "opencode" | "codex" | "claude"

export interface TvctlAiConfig {
  provider: TvctlAiProvider
  model?: string
}

export type RokuKey =
  | "Home"
  | "Rev"
  | "Fwd"
  | "Play"
  | "Select"
  | "Left"
  | "Right"
  | "Down"
  | "Up"
  | "Back"
  | "InstantReplay"
  | "Info"
  | "Backspace"
  | "Search"
  | "Enter"
  | "PowerOff"
  | "PowerOn"
  | "VolumeUp"
  | "VolumeDown"
  | "VolumeMute"

export const rokuKeys = [
  "Home",
  "Rev",
  "Fwd",
  "Play",
  "Select",
  "Left",
  "Right",
  "Down",
  "Up",
  "Back",
  "InstantReplay",
  "Info",
  "Backspace",
  "Search",
  "Enter",
  "PowerOff",
  "PowerOn",
  "VolumeUp",
  "VolumeDown",
  "VolumeMute",
] as const satisfies readonly RokuKey[]
