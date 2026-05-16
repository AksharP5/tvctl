# tvctl

A terminal remote and CLI for Roku TVs.

`tvctl` starts as a Roku-first local network controller. It discovers Roku devices, sends keypresses, launches apps, types from your laptop keyboard, and opens an OpenTUI remote in your terminal.

## Install

```bash
bun install
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
tvctl remote          # Same as above
tvctl discover        # Find Roku TVs on your local network
tvctl ask "open YouTube and search Drake album"
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

Common requests are planned locally. Ambiguous requests fall back to OpenCode using a free model. Override the model with:

```bash
TVCTL_AI_MODEL=opencode/big-pickle tvctl ask "open spotify and search future"
```

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
- `p`: Play/pause
- `r`: Instant replay
- `i`: type text mode
- `F5`: refresh active app
- `q` or `Esc`: quit

The right pane lists apps. Press `Tab` to focus it, type to filter, and press `Enter` to launch the selected app.

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
