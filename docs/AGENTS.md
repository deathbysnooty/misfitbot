# Docs AGENTS.md

This is the short reference version of the main project spec in `/AGENTS.md`.

## What the bot is now for

The bot is being repurposed into:

- a private Discord business dashboard
- a content and reporting assistant for `ibtuition.sg`
- a personal operator assistant for daily reminders, planning, and updates

## API direction

Build new features around OpenAI, not Anthropic.

## Main feature pillars

1. SEO rank alerts from SQLite
2. social post generation
3. daily morning briefing
4. idea capture and expansion
5. lesson plan generation
6. optional personal productivity tools

## Build principles

- keep flows private-server friendly
- use per-guild config instead of hardcoded server IDs when appropriate
- keep outputs concise and actionable
- preserve paused legacy code only where it does not block the new direction

For the full product and implementation context, read `/AGENTS.md`.
