# tvctl

A terminal remote and CLI for Roku TVs.

`tvctl` starts as a Roku-first local network controller. It discovers Roku devices, sends keypresses, launches apps, types from your laptop keyboard, and opens an OpenTUI remote in your terminal.

## Install

Run without installing:

```bash
bunx tvctl
npx tvctl
```

Install globally:

```bash
bun add -g tvctl
npm install -g tvctl
```

`tvctl` is published on npm. The npm package currently requires Bun because the CLI entrypoint runs with `#!/usr/bin/env bun`; install Bun first if you want to use `npx`, `npm install -g`, or `bunx`.

First setup:

```bash
tvctl discover
tvctl
```

Local development from this repo:

```bash
bun install
bun src/cli.ts discover
bun src/cli.ts
```

## Usage

```bash
bun src/cli.ts discover
bun src/cli.ts
```

After discovery, `tvctl` saves the first Roku as your default device in `~/.config/tvctl/config.json`.

## Commands

```bash
tvctl                 # Open the OpenTUI remote
tvctl --model         # Open provider/model setup directly
tvctl mcp             # Start the MCP stdio server for OpenCode and other agents
tvctl remote          # Same as above
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

Natural language can also be passed directly:

```bash
tvctl open youtube and search drake album
tvctl on prime search for shrek
tvctl switch to live tv
tvctl go home
tvctl mute
```

Ask requests use the fastest planner that should satisfy the request. In `auto` mode, tvctl tries the local planner first for known Roku intents, then uses the configured AI planner only when the request is new, fuzzy, or outside the local planner. Direct remote commands stay local so they remain instant.

Search requests use Roku's ECP `/search/browse` endpoint with a provider hint when you name an app, so `tvctl open Prime and search The Batman` does not need to guess whether Prime is still loading, showing profiles, or sitting on its home screen. Roku does not expose a normal screenshot or focused-control API through ECP, so tvctl cannot literally see arbitrary TV UI state from the network alone. True screen-aware control would require an observation source such as an HDMI capture card, camera, or app-specific API.

The suggested default is OpenCode with `opencode/big-pickle`, because it has been consistently free. It can be slower than using the physical remote for tiny tasks, so users with Codex, Claude, or paid OpenCode-backed models should pick a faster model.

Install and log in to the provider CLI you want to use:

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

Planner modes:

- `auto`: local planner first for speed, then AI for requests local parsing cannot handle.
- `ai-first`: AI only. Use this to test the marketing-path planner behavior.
- `local-first`: local planner first, then AI only when local parsing cannot handle the request.
- `local-only`: no AI provider calls.

Set `TVCTL_AI_PLANNER_BUDGET_MS` to change the `auto` planning budget. Set `TVCTL_PLANNER` to choose a default mode.

You can also configure the planner from the main TUI. Run `tvctl`, press `c`, choose the provider, choose a model, and press `Enter` or click `Save`. `tvctl` loads model catalogs from provider CLIs when available, such as `opencode models` and `codex debug models`; custom model entry is still available for providers or models that do not expose a local catalog.

The main TUI also has an agent prompt. Press `/`, type a request like `open prime` or `search youtube for drake album`, then press `Enter`.

The TUI shows the active provider/model and checks whether the selected provider CLI appears ready. If it says the provider needs login or setup, run the matching login command above.

Provider support:

- `opencode`: uses `opencode run -m <model>`.
- `codex`: uses `codex exec -m <model>`.
- `claude`: uses `claude -p --model <model>`.

Direct commands such as `tvctl netflix`, `tvctl youtube search drake album`, and `tvctl go home` do not require any AI provider.

CLI remote shortcuts include `up`, `down`, `left`, `right`, `ok`, `select`, `home`, `back`, `play`, `pause`, `search`, `info`, `mute`, `vol-up`, `vol-down`, `power-on`, and `power-off`. The generic form `tvctl key <key>` also accepts Roku key names case-insensitively, such as `tvctl key left`.

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

`tvctl` includes an MCP stdio server so MCP-capable agents such as OpenCode can control your Roku from a chat session. This is intentionally a local command MCP, not a remote URL MCP, because Roku TVs are controlled over your private home network. A hosted remote MCP server on the internet cannot normally reach a user's LAN Roku.

After the package is installed, either command starts the same MCP server:

```bash
tvctl mcp
tvctl-mcp
```

Install globally if you want the command available everywhere:

```bash
bun add -g tvctl
```

For local development from this repo:

```bash
bun src/mcp.ts
```

Add it to OpenCode:

```bash
opencode mcp add
```

When prompted for the server type, choose the local command/stdio option. Do not choose `Remote`; that screen expects an HTTP URL for a hosted MCP server.

Use one of these local commands:

```bash
tvctl mcp
tvctl-mcp
```

or, from this repo:

```bash
bun /absolute/path/to/tvctl/src/mcp.ts
```

The server exposes tools for discovery, installed apps, active app, keypresses, typing, launching apps, Roku search, and concise natural-language control. In an MCP chat, the model should usually call the primitive tools directly. The `tvctl_control` tool defaults to local-only planning to avoid recursive loops where OpenCode calls tvctl, and tvctl calls OpenCode again; pass `planner=ai-first` only when you explicitly want nested AI planning.

## Development

```bash
bun install
bun run typecheck
bun src/cli.ts --help
```

## Publishing Checklist

- Add an npm automation token as `NPM_TOKEN`, or configure npm trusted publishing for the GitHub Actions release workflow.
- Use conventional commits on `main`: `fix:` creates patch releases, `feat:` creates minor releases, and `feat!:` or `BREAKING CHANGE:` creates major releases.
- Release Please opens or updates one release PR that bumps `package.json`, updates `CHANGELOG.md`, and groups releasable commits.
- Merge the release PR when you want to publish the grouped updates. The workflow publishes npm, tags `vX.Y.Z`, and creates a GitHub release.
- Keep Roku setup docs clear: users need both devices on the same local network and Roku mobile app control enabled under `Settings > System > Advanced system settings > Control by mobile apps > Network access`.
