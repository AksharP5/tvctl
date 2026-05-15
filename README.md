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
tvctl apps            # List installed Roku apps
tvctl launch youtube  # Launch an app by id or fuzzy name
tvctl active          # Show the active app
tvctl key Home        # Send a Roku keypress
tvctl type "hello"    # Type into the active Roku text field
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

## Roku Support

Roku devices expose the External Control Protocol on the local network. `tvctl` uses port `8060` and the standard endpoints:

- `/query/device-info`
- `/query/apps`
- `/query/active-app`
- `/keypress/{key}`
- `/launch/{appId}`

## Development

```bash
bun install
bun run typecheck
bun src/cli.ts --help
```
