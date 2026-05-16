# Contributing to pi-xai-grok-oauth

Thank you for your interest in contributing to the xAI Grok OAuth provider for pi!

## Getting Started

### Prerequisites

- [pi](https://pi.dev) (latest version recommended)
- Node.js 20+
- Git
- A GitHub account

### Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/perezdap/pi-xai-grok-oauth.git
   cd pi-xai-grok-oauth
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Test the extension locally**

   You can load the extension directly without publishing:

   ```powershell
   # From the project root
   pi -e .
   ```

   Or copy/symlink it into your pi extensions folder:

   ```powershell
   # Windows
   cp -r . "$env:USERPROFILE\.pi\agent\extensions\pi-xai-grok-oauth"
   ```

4. **Make your changes**

   - Edit `index.ts` for provider logic
   - Update `package.json` if adding new models or configuration
   - Update documentation in `README.md` when behavior changes

5. **Test your changes**

   - Use `/reload` inside pi after making changes
   - Test the OAuth flow (`/login xai-oauth`)
   - Test all registered models
   - Verify that reasoning models behave correctly

## Making Changes

### Code Style

- Use TypeScript (the project uses strict mode)
- Follow existing patterns in `index.ts`
- Keep the extension lightweight — avoid adding heavy dependencies

### Commit Messages

We follow conventional commits where possible:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation changes
- `chore:` maintenance / tooling
- `refactor:`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure the CI passes (it runs on every PR)
4. Update `README.md` and `CHANGELOG.md` if needed
5. Open a Pull Request with a clear description
6. Wait for review (we try to respond within a few days)

## Reporting Issues

- Use the **Bug report** template for problems
- Use the **Feature request** template for new ideas
- Include your pi version, OS, and relevant logs when possible

## Questions?

Feel free to open a Discussion or reach out via GitHub Issues.

Thank you for helping improve Grok access inside pi!
