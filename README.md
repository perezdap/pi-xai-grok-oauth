# pi-xai-grok-oauth

[![CI](https://github.com/perezdap/pi-xai-grok-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/perezdap/pi-xai-grok-oauth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pi Package](https://img.shields.io/badge/pi-package-5865F2)](https://pi.dev)

Official xAI Grok OAuth provider for [pi](https://pi.dev) — brings SuperGrok / Premium subscription access (including Grok Build) directly into pi via the official xAI OAuth flow.

Based on the battle-tested `xai-oauth` implementation from the Hermes agent.

## Features

- Full OAuth 2.0 + PKCE login flow (`/login xai-oauth`)
- Automatic token refresh
- Support for the latest Grok models via the Responses API
- Correct handling of reasoning models (avoids 400 errors on unsupported `reasoning.effort`)
- Works with remote/SSH pi instances (via local port forwarding)
- Environment-variable overrides for advanced use

## Installation

### From the pi package gallery (recommended once published)

```bash
pi install npm:pi-xai-grok-oauth
```

Then reload:

```text
/reload
```

### Local development / testing

```bash
# From inside the extension directory
cd ~/.pi/agent/extensions/xai-grok-oauth
npm install   # (creates node_modules if you add deps later)
```

Then run pi with the extension explicitly:

```powershell
pi -e ~/.pi/agent/extensions/xai-grok-oauth
```

Or place it in your global extensions folder and use `/reload`.

## Usage

1. **Login with your xAI account**

   ```text
   /login xai-oauth
   ```

   This opens your browser to the official xAI authorization page. After approving, pi receives the tokens via a local callback.

2. **Select a Grok model**

   ```text
   /model xai-oauth/grok-build
   ```

   Or cycle with `Ctrl+P`.

**Dynamic Model Discovery (new)**

The extension now queries xAI's `/v1/models` endpoint **live** after you log in. The model picker and `/xai-models` command are refreshed from discovered model IDs; reasoning support, cost estimates, thinking level mapping, and context windows are derived from those IDs with safe fallbacks.

```text
/xai-models          # See live list + refresh model picker
/model xai-oauth/grok-4.20-multi-agent-0309
```

## Available Models (default)

| Model ID                        | Name                        | Reasoning | Notes                          |
|---------------------------------|-----------------------------|-----------|--------------------------------|
| `grok-build`                    | Grok Build                  | Yes       | Best "Build" experience parity |
| `grok-4.3`                      | Grok 4.3                    | Yes       | General purpose + reasoning    |
| `grok-4.20-0309-reasoning`      | Grok 4.20 Reasoning         | Yes       | High context                   |
| `grok-4.20-0309-non-reasoning`  | Grok 4.20 Non-Reasoning     | No        | Fast, no reasoning dial        |
| `grok-4.20-multi-agent-0309`    | Grok 4.20 Multi-Agent       | Yes       | Multi-agent workflows          |

You can customize the model list with the `PI_XAI_OAUTH_MODELS` environment variable.

## Environment Variables

```powershell
# Custom API endpoint (rarely needed)
$env:PI_XAI_BASE_URL = "https://api.x.ai/v1"

# Limit or reorder models
$env:PI_XAI_OAUTH_MODELS = "grok-build,grok-4.3,grok-4.20-multi-agent-0309"

# Change the local OAuth callback port (default 56121)
$env:PI_XAI_OAUTH_CALLBACK_PORT = "56121"

# Bypass OAuth entirely and use a raw bearer token (advanced)
$env:XAI_OAUTH_TOKEN = "xai-..."
```

## Remote / SSH Usage

The OAuth callback server listens on `127.0.0.1:56121`.

If you run pi on a remote machine, open a local port forward first:

```powershell
ssh -N -L 56121:127.0.0.1:56121 user@remote-host
```

Then run `/login xai-oauth` inside the remote pi session and complete the browser flow on your local machine.

## Troubleshooting

### "Model grok-build does not support parameter reasoningEffort"

This extension automatically strips the `reasoning` parameter for models that do not support it (including `grok-build`). If you see this error, make sure you are running the latest version of this extension and have done `/reload`.

### "Each message must have at least one content element"

This was a known issue with replaying reasoning items on follow-up turns. The extension now correctly filters these out for xAI's Responses endpoint. Start a fresh chat after updating.

### Images / vision not supported

All Grok models via this extension declare `input: ["text"]` only. Pasting or attaching images is disabled (xAI's current Responses API surface returns 422 ModelInput deserialization errors on image payloads). The previous sanitization layer has been kept as a safety net.

### Login fails or callback never arrives

- Check that port 56121 is free
- Temporarily disable any VPN / firewall that might block localhost callbacks
- Try a different port via `PI_XAI_OAUTH_CALLBACK_PORT`

## Development

This extension is written in TypeScript and uses only Node built-ins + the official pi SDKs.

To contribute or customize:

1. Clone the repo
2. Edit `index.ts`
3. Test with `pi -e .`
4. Submit a PR

## License

MIT

## Credits

- xAI for the excellent Grok models and OAuth surface
- The Hermes agent team for the original `xai-oauth` flow and hard-won knowledge about the Responses API quirks
- The pi team for the beautiful extension system

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, development workflow, and how to submit pull requests.

## Development

This project uses TypeScript with a strict `tsconfig.json`. After making changes:

```bash
npm install
npx tsc --noEmit   # Type check
pi -e .              # Test in pi
```

## Releasing

We use automated releases:

1. Update version in `package.json`
2. Commit and push a tag: `git tag v1.0.0 && git push --tags`
3. The Release workflow will automatically:
   - Run CI
   - Publish to npm
   - Create a GitHub Release with auto-generated notes

See `.github/workflows/release.yml` for details.

## License

MIT
