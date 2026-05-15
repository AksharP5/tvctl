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
