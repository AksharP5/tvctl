import type { RokuApp } from "../types"
import { RokuClient } from "./client"

export function findApp(apps: RokuApp[], query: string): RokuApp | undefined {
  const normalized = normalize(query)
  return (
    apps.find((app) => app.id === query) ??
    apps.find((app) => normalize(app.name) === normalized) ??
    apps.find((app) => normalize(app.name).includes(normalized)) ??
    apps.find((app) => normalized.includes(normalize(app.name)))
  )
}

export async function launchApp(client: RokuClient, apps: RokuApp[], query: string): Promise<RokuApp> {
  const app = findApp(apps, query)
  if (!app) {
    throw new Error(`No Roku app matched "${query}". Run \`tvctl apps\` to see installed apps.`)
  }

  await client.launch(app.id)
  return app
}

export async function searchInApp(client: RokuClient, apps: RokuApp[], appQuery: string, searchQuery: string): Promise<RokuApp> {
  const app = await launchApp(client, apps, appQuery)
  await sleep(2500)
  await client.keypress("Search")
  await sleep(900)
  await client.typeText(searchQuery)
  return app
}

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
