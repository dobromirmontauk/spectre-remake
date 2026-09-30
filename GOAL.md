# GOAL

## What We're Trying To Accomplish

Recreate the 1991 Mac game Spectre as a playable browser tank game, preserving its visual character and single-player campaign while supporting local and network multiplayer. Publish a static browser build that people can play without installing a game client.

Explore smarter tank opponents as an optional mode. The current experiment uses Jev commanders with limited observations and a safe local executor; ordinary play remains available without an AI backend.

## Why

Make the original tank game's feel accessible on the web and investigate whether fast model decisions can produce interesting, challenging opponents without full game knowledge.

## Definition of Success

- Playable single-player, local multiplayer and network multiplayer with deterministic simulation.
- A public browser build and reproducible deployment process.
- Optional AI experiments have explicit information boundaries, spending limits and watchable evaluation evidence.
- Documented next steps and a blog / LinkedIn post draft prepared for review before publication.

## Out of Scope

- Model calls inside the deterministic simulation or independent model decisions on multiplayer peers.
- Publicly exposing provider credentials or running uncapped paid inference.
- Claiming human enjoyment or a reliable win rate from a few autopilot trials alone.
