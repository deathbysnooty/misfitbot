# AGENTS.md — Business Dashboard Bot Spec

This file gives Codex the working product context for the current bot direction.
Read this before proposing architecture or writing features.

## Product Direction

The bot is being repurposed from a community Discord bot into a private operating console.
Its new role is:

- business dashboard for IB Tuition Centre in Singapore
- private content and reporting assistant
- personal operator assistant for daily tasks, reminders, planning, and updates

The goal is not a public fun bot. The goal is a reliable private assistant inside Discord.

## Business Context

- Business: `IB Tuition Centre`
- Website: `ibtuition.sg`
- Market: IB students and parents in Singapore
- Subjects:
  - IB Math AA / AI
  - IB Chemistry
  - IB Physics
  - IB Biology
  - IB Economics
  - IB English
  - IB Chinese
  - TOK

The owner runs the business hands-on and wants the bot to reduce admin load, speed up content work, and centralize daily visibility.

## Platform Direction

The implementation should be built around the OpenAI API, not Anthropic.

Preferred OpenAI stack:

- chat and structured generation: lightweight GPT-family models already used in this repo
- image generation: `gpt-image-1` if needed
- transcription: `gpt-4o-mini-transcribe` if needed
- text-to-speech: `gpt-4o-mini-tts` if needed

Do not write new product specs assuming Anthropic unless explicitly requested.

## Current High-Level Goal

Treat the Discord server like an internal command center with a few major use cases:

1. reporting and alerts
2. content generation and repurposing
3. daily briefing and planning
4. quick capture of ideas and business notes
5. lesson and teaching support
6. personal task support for the owner

## Core Features To Build

These are the intended product capabilities. Functionality can stay the same in spirit even if implementation details change.

### 1. Google Ranking Alerts

Purpose:
- detect meaningful keyword movement early

Behavior:
- scheduled check every day at `7:00am` Singapore time
- read ranking history from SQLite
- compare current rank vs 7 days ago
- post alerts when:
  - keyword drops by 3 or more
  - keyword falls out of top 10
  - keyword improves by 5 or more
- post to `#seo-reports`
- if no meaningful changes, post a one-line stability update

Expected database:

```sql
CREATE TABLE ranks (
  id INTEGER PRIMARY KEY,
  keyword TEXT,
  position INTEGER,
  date TEXT,
  domain TEXT
);
```

Config:

```env
RANKS_DB_PATH=./ranks.db
```

Notes:
- database is read-only
- do not mutate rank data

### 2. Social Content Generator

Purpose:
- turn blog ideas or excerpts into ready-to-post social content

Slash command:

```text
/social topic:[topic or excerpt] platform:[instagram|linkedin|both]
```

Expected output:
- Instagram:
  - 150 to 220 words
  - warm, conversational
  - 1 to 2 emojis max
  - 3 to 5 relevant hashtags
  - soft CTA
- LinkedIn:
  - 200 to 280 words
  - professional tone
  - structure: hook -> insight -> takeaway -> CTA
  - max 3 hashtags

Destination:
- `#content-ideas`

### 3. Daily Morning Briefing

Purpose:
- replace manual checking across multiple places

Schedule:
- weekdays at `7:30am` Singapore time

Channel:
- `#daily-briefing`

Contents:
- rank pulse
- one short business thought of the day
- Monday-only weekly focus summary

Style:
- concise
- scannable
- one embed, not a wall of text

### 4. Ideas Capture And Expansion

Purpose:
- capture rough thoughts before they disappear

Commands:

```text
/idea [text]
/ideas
```

Behavior:
- store ideas locally with timestamp
- immediately expand each idea into a short practical mini-plan
- review shows latest saved ideas

Storage:

```json
[
  {
    "id": 1,
    "text": "Write a guide on TOK essay tips",
    "expanded": "...",
    "timestamp": "2026-03-23T08:00:00+08:00"
  }
]
```

### 5. Lesson Plan Generator

Purpose:
- reduce lesson prep time

Command:

```text
/lesson subject:[subject] topic:[topic] level:[HL|SL]
```

Behavior:
- generate a structured 60-minute lesson plan
- align with IB terminology and level
- include:
  - objectives
  - starter
  - teaching flow
  - practice
  - exit check
  - homework
  - exam-style question

Destination:
- `#lesson-plans`

Long outputs:
- send embed summary plus `.md` attachment

## Recommended Extra Features

These are not mandatory yet, but they fit the product well:

- enquiry reply drafting
- daily task digest
- reminder and follow-up tracking
- weekly KPI snapshot
- content calendar assistant
- website page audit assistant
- parent objection handling drafts
- tutor operations notes

## Discord Channels

Target private server structure:

- `#seo-reports`
- `#competitor-intel`
- `#blog-drafts`
- `#content-ideas`
- `#enquiry-summaries`
- `#daily-briefing`
- `#lesson-plans`
- optional private ops channels for tasks, reminders, and planning

## Environment Variables

Expected variables:

```env
OPENAI_API_KEY=
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
RANKS_DB_PATH=./ranks.db
```

Additional variables may be introduced, but avoid hardcoding secrets or fixed server IDs where per-guild config is better.

## Architecture Expectations

- modular Discord.js code
- slash commands registered explicitly
- handlers separated by concern
- scheduled jobs use Singapore timezone
- SQLite allowed for local structured storage
- per-guild config should live in app storage, not one global env var, unless the feature is truly global

## Product Rules

- optimize for usefulness, clarity, and low-friction workflows
- private-server UX matters more than flashy public-server UX
- outputs should be concise unless the task inherently needs depth
- content should reflect the IB tuition niche in Singapore
- do not keep old community features active unless explicitly requested

## Do Not Assume

- do not assume Anthropic is the API provider
- do not assume the old MisfitBot entertainment feature set should remain active
- do not assume one hardcoded server is the long-term deployment model

## Migration Reality

This repo may still contain paused legacy community-bot code.
When building new business features:

- preserve useful infrastructure where possible
- prefer replacement over awkward coexistence if a legacy path fights the new product direction
- keep migrations reversible and explicit

Last updated: March 2026
