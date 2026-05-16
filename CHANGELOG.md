# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release of `pi-xai-grok-oauth`
- Full xAI Grok OAuth (SuperGrok) support for pi
- Models: grok-build, grok-4.3, grok-4.20-*, etc.
- Automatic filtering of unsupported `reasoning.effort` and replayed reasoning items
- Support for remote/SSH usage via port forwarding

## [0.1.0] - 2026-05-15

- First working version extracted from local `~/.pi/agent/extensions`
- Patched to fix 400 errors on grok-build and grok-4.3 follow-ups
