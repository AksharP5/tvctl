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
tvctl type "hello"    # Type into the active Roku text field
```

Natural language can also be passed directly:

```bash
tvctl open youtube and search drake album
tvctl switch to live tv
tvctl go home
tvctl mute
```

Common requests are planned locally and do not require AI. Ambiguous requests can fall back to an AI planner.

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
```

You can also configure the planner from the main TUI. Run `tvctl`, press `c`, choose the provider, edit the model, and press `Enter` to save.

The main TUI also has an agent prompt. Press `/`, type a request like `open prime` or `search youtube for drake album`, then press `Enter`.

The TUI shows the active provider/model and checks whether the selected provider CLI appears ready. If it says the provider needs login or setup, run the matching login command above.

Provider support:

- `opencode`: uses `opencode run -m <model>`.
- `codex`: uses `codex exec -m <model>`.
- `claude`: uses `claude -p --model <model>`.

Direct commands such as `tvctl netflix`, `tvctl youtube search drake album`, and `tvctl go home` do not require any AI provider.

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
