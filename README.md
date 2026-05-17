# tvctl

A Roku TV controller for OpenCode, plus a CLI and terminal remote.

The recommended use case is the MCP server: connect `tvctl` to OpenCode and control your Roku from an AI chat. `tvctl` also includes direct CLI commands and a terminal UI if you want to use it without an MCP client.

## Install

Install Bun first, then install `tvctl` globally:

```bash
bun add -g tvctl
```

You can also run it without installing:

```bash
bunx tvctl
```

The npm package currently requires Bun because the command entrypoints run with `#!/usr/bin/env bun`.

## Quick Start

For OpenCode, use the MCP setup below. For direct terminal control:

```bash
tvctl discover
tvctl
```

`tvctl discover` finds Roku devices on your local network and saves the first one as your default device in `~/.config/tvctl/config.json`. `tvctl` opens the terminal remote.

If discovery fails, make sure your Roku and computer are on the same network, then enable:

`Settings > System > Advanced system settings > Control by mobile apps > Network access`

Set it to `Enabled`.

## OpenCode MCP Setup

This is the recommended way to use `tvctl`. The MCP server lets OpenCode control your Roku from a chat session.

```bash
bun add -g tvctl
tvctl discover
opencode mcp add
```

When OpenCode asks for the MCP server type, choose the local command/stdio option. Do not choose `Remote`; Roku TVs are controlled over your private home network, so a hosted internet MCP server normally cannot reach them.

Use this command:

```bash
tvctl mcp
```

After that, ask OpenCode things like:

```text
Use tvctl to open YouTube and search Drake album reactions.
Use tvctl to open Prime Video and search for Shrek.
Use tvctl to press Home, then open Netflix.
```

OpenCode acts as the AI brain. `tvctl mcp` is the local bridge between OpenCode and the Roku on your Wi-Fi.

## Commands

These are useful if you want direct CLI or TUI control without OpenCode.

```bash
tvctl                 # Open the OpenTUI remote
tvctl --model         # Open provider/model setup directly
tvctl mcp             # Start the MCP stdio server for OpenCode and other agents
tvctl remote          # Open the OpenTUI remote
tvctl discover        # Find Roku TVs on your local network
tvctl ask "open YouTube and search Drake album"
tvctl youtube          # Launch YouTube without opening the TUI
tvctl netflix          # Launch Netflix without opening the TUI
tvctl stitch           # Works if Stitch is installed on your Roku
tvctl apps            # List installed Roku apps
tvctl launch youtube  # Launch an app by id or fuzzy name
tvctl active          # Show the active app
tvctl key Home        # Send a Roku keypress
tvctl up              # Send a remote direction without opening the TUI
tvctl ok              # Select the focused item
tvctl back            # Go back
tvctl type "hello"    # Type into the active Roku text field
```

Natural language can also be passed directly to the CLI:

```bash
tvctl open youtube and search drake album
tvctl on prime search for shrek
tvctl switch to live tv
tvctl go home
tvctl mute
```

Direct commands such as `tvctl netflix`, `tvctl youtube search drake album`, and `tvctl go home` do not require any AI provider.

Search requests use Roku's ECP `/search/browse` endpoint with a provider hint when you name an app, so `tvctl open Prime and search The Batman` does not need to guess whether Prime is still loading, showing profiles, or sitting on its home screen.

## AI In The TUI/CLI

The easiest AI setup is OpenCode through MCP. The built-in TUI/CLI planner is still available if you want to use `tvctl ask` directly.

Install and log in to the provider CLI you want:

```bash
opencode auth login
codex login
claude login
```

Configure the planner:

```bash
tvctl --model
tvctl ai
tvctl ai-config --provider opencode --model opencode/big-pickle
tvctl ai-config --provider codex --model gpt-5.1-codex-mini
tvctl ai-config --provider claude --model claude-sonnet-4-5
tvctl ask --model gpt-5.4 "open spotify and search future"
tvctl ask --planner ai-first "find a relaxing fireplace video on youtube"
tvctl ask --planner local-only "go home"
```

In `auto` mode, tvctl tries the fast local planner first, then uses the configured AI provider only when local parsing cannot handle the request. Use `--planner ai-first` when you explicitly want the AI planner path.

You can also configure the planner from the main TUI. Run `tvctl`, press `c`, choose the provider, choose a model, and press `Enter` or click `Save`. `tvctl` loads model catalogs from provider CLIs when available, such as `opencode models` and `codex debug models`; custom model entry is still available for providers or models that do not expose a local catalog.

The main TUI also has an agent prompt. Press `/`, type a request like `open prime` or `search youtube for drake album`, then press `Enter`.

## App Shortcuts

App shortcuts are dynamic. `tvctl` queries the apps installed on your Roku and fuzzy-matches the first argument:

```bash
tvctl youtube
tvctl netflix
tvctl stitch
tvctl "prime video"
```

There is no hardcoded list of app commands. If an app is not installed, `tvctl <app>` fails with a clear message and suggests `tvctl apps`. If the request looks like a broader instruction, such as `tvctl open the music app and search future`, `tvctl` can pass it to the AI planner.

Pass `--host <ip>` to any device command to skip discovery/config:

```bash
tvctl --host 192.168.1.20
tvctl apps --host 192.168.1.20
```

## Remote Keys

- Arrow keys or `h`/`j`/`k`/`l`: move
- `Enter` or `Space`: OK/select
- `/`: ask tvctl to run a TV request
- `t`: find and switch Roku TVs
- `m`: Home
- `b`: Back
- `s`: Search
- `c`: AI provider/model settings
- `p`: Play/pause
- `[`: Rewind
- `]`: Fast-forward
- `r`: Instant replay
- `+` or `=`: Volume up
- `-`: Volume down
- `0` or `v`: Mute
- `o`: Power on
- `x`: Power off
- `?`: Info
- `i`: type text mode
- `F5`: refresh active app
- `q` or `Esc`: quit

Press `a` or `Tab` to open apps, type to filter, and press `Enter` to launch the selected app.

Press `t` to open the TV switcher. It discovers Roku TVs on the network, marks the current TV, and saves the selected TV as the default when you switch.

## Roku Support

Roku devices expose the External Control Protocol on the local network. `tvctl` uses port `8060` and the standard endpoints:

- `/query/device-info`
- `/query/apps`
- `/query/active-app`
- `/keypress/{key}`
- `/launch/{appId}`

Power behavior:

- `PowerOff` works when the Roku is awake and reachable on the network.
- `PowerOn` only works if the Roku TV can still receive network control commands while the screen is off. On many Roku TVs, that means enabling Fast TV Start or equivalent standby network behavior.
- If the TV is fully powered down, unplugged, in deep sleep, or no longer reachable at port `8060`, `tvctl` cannot wake it over ECP.
- Roku streaming players are different from Roku TVs: many stay powered and network-connected, while the TV itself is controlled through HDMI-CEC/TV power settings.

If discovery does not find your Roku, check the TV setting:

`Settings > System > Advanced system settings > Control by mobile apps > Network access`

Set it to `Enabled`. Use `Permissive` only if your LAN uses non-private IP ranges or a more advanced network setup.

You can also pass `--host <ip>` directly if discovery is blocked by your network.

## MCP Server

`tvctl mcp` starts a local stdio MCP server. MCP clients can use it to discover Roku devices, list installed apps, check the active app, press remote keys, type text, launch apps, search, and run concise natural-language TV requests.

```bash
tvctl mcp
tvctl-mcp
```

For local development from this repo, use:

```bash
bun /absolute/path/to/tvctl/src/mcp.ts
```

In an MCP chat, the model should usually call the primitive tools directly. The `tvctl_control` tool defaults to local-only planning to avoid recursive loops where OpenCode calls tvctl, and tvctl calls OpenCode again.

Roku does not expose a normal screenshot or focused-control API through ECP, so tvctl cannot literally see arbitrary TV UI state from the network alone. True screen-aware control would require an observation source such as an HDMI capture card, camera, or app-specific API.

## Development

```bash
bun install
bun run typecheck
bun src/cli.ts --help
```

Local development from this repo:

```bash
bun install
bun src/cli.ts discover
bun src/cli.ts
```

## Publishing Checklist

- Add an npm automation token as `NPM_TOKEN`, or configure npm trusted publishing for the GitHub Actions release workflow.
- Use conventional commits on `main`: `fix:` creates patch releases, `feat:` creates minor releases, and `feat!:` or `BREAKING CHANGE:` creates major releases.
- Release Please opens or updates one release PR that bumps `package.json`, updates `CHANGELOG.md`, and groups releasable commits.
- Merge the release PR when you want to publish the grouped updates. The workflow publishes npm, tags `vX.Y.Z`, and creates a GitHub release.
- Keep Roku setup docs clear: users need both devices on the same local network and Roku mobile app control enabled under `Settings > System > Advanced system settings > Control by mobile apps > Network access`.
