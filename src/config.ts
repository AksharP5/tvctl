import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type { RokuDevice, TvctlAiConfig, TvctlConfig } from "./types"

const configPath = join(homedir(), ".config", "tvctl", "config.json")

export async function readConfig(): Promise<TvctlConfig> {
  try {
    const raw = await readFile(configPath, "utf8")
    return JSON.parse(raw) as TvctlConfig
  } catch {
    return {}
  }
}

export async function writeConfig(config: TvctlConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

export async function setDefaultDevice(device: RokuDevice): Promise<void> {
  const config = await readConfig()
  await writeConfig({ ...config, defaultDevice: device })
}

export async function getDefaultDevice(): Promise<RokuDevice | undefined> {
  const config = await readConfig()
  return config.defaultDevice
}

export async function setAiConfig(ai: TvctlAiConfig): Promise<void> {
  const config = await readConfig()
  await writeConfig({ ...config, ai })
}

export async function getAiConfig(): Promise<TvctlAiConfig | undefined> {
  const config = await readConfig()
  return config.ai
}

export function getConfigPath(): string {
  return configPath
}
