# tvctl

A terminal remote and CLI for Roku TVs.

`tvctl` starts as a Roku-first local network controller. It discovers Roku devices, sends keypresses, launches apps, types from your laptop keyboard, and opens an OpenTUI remote in your terminal.

## Install

```bash
bun install
```

Local development:

```bash
bun link
tvctl --help
```

After publishing to npm, users can install or run it with:

```bash
bun add -g tvctl
bunx tvctl
npx tvctl
```

`tvctl` currently requires Bun because the package bin runs TypeScript through Bun. `npx tvctl` will still require Bun to be installed on the user's machine.

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

## Roku Support

Roku devices expose the External Control Protocol on the local network. `tvctl` uses port `8060` and the standard endpoints:

- `/query/device-info`
- `/query/apps`
- `/query/active-app`
- `/keypress/{key}`
- `/launch/{appId}`

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

- Publish npm package: `npm publish`.
- Create a tagged GitHub release with built source tarball.
- Add a Homebrew tap formula that installs the npm package or downloads the release tarball and creates the `tvctl` executable.
- Keep Roku setup docs clear: users need both devices on the same local network and Roku mobile app control enabled under `Settings > System > Advanced system settings > Control by mobile apps > Network access`.
