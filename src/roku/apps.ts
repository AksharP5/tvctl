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
  const app = findApp(apps, appQuery)
  if (!app) {
    throw new Error(`No Roku app matched "${appQuery}". Run \`tvctl apps\` to see installed apps.`)
  }

  await client.searchInApp(app.id, searchQuery)
  return app
}

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}
