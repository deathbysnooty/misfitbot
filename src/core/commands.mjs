export function getCommands({ ApplicationCommandType }) {
  return [
    { name: "help", description: "Show what MisfitBot can do.", options: [] },
    {
      name: "ask",
      description: "Ask MisfitBot anything (reply context or message link).",
      options: [
        {
          name: "prompt",
          description: "What do you want to ask?",
          type: 3,
          required: true,
        },
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "imagine",
      description: "Generate an image from a prompt.",
      options: [
        {
          name: "prompt",
          description: "Describe the image you want.",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "summarize",
      description: "Summarize a message (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "explain",
      description: "Explain a message (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "analyzeimage",
      description: "Analyze an image (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
        {
          name: "prompt",
          description: "What should I look for? (optional)",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "transcribe",
      description: "Transcribe a voice note/audio (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
        {
          name: "explain",
          description: "Also explain what it means",
          type: 5,
          required: false,
        },
      ],
    },
    {
      name: "summarizechannel",
      description: "Summarize last N messages in this channel (max 100).",
      options: [
        {
          name: "count",
          description: "How many recent messages? (1–100)",
          type: 4,
          required: true,
        },
      ],
    },
    {
      name: "voicenote",
      description: "Convert text into a voice-note style audio file.",
      options: [
        {
          name: "text",
          description: "Text to speak",
          type: 3,
          required: true,
        },
        {
          name: "voice",
          description: "Voice style",
          type: 3,
          required: false,
          choices: [
            { name: "alloy", value: "alloy" },
            { name: "nova", value: "nova" },
            { name: "onyx", value: "onyx" },
            { name: "echo", value: "echo" },
            { name: "fable", value: "fable" },
            { name: "shimmer", value: "shimmer" },
          ],
        },
      ],
    },
    {
      name: "beautify",
      description: "Beautify text (your input or a replied/linked message).",
      options: [
        {
          name: "text",
          description: "Text to beautify (optional if using message/reply context)",
          type: 3,
          required: false,
        },
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
        {
          name: "style",
          description: "Visual style (ASCII/look)",
          type: 3,
          required: false,
          choices: [
            { name: "box", value: "box" },
            { name: "double_box", value: "double_box" },
            { name: "banner", value: "banner" },
            { name: "wave", value: "wave" },
            { name: "glitch", value: "glitch" },
            { name: "spaced", value: "spaced" },
            { name: "tinycaps", value: "tinycaps" },
            { name: "bubble", value: "bubble" },
            { name: "leet", value: "leet" },
            { name: "shadow", value: "shadow" },
            { name: "matrix", value: "matrix" },
            { name: "staircase", value: "staircase" },
            { name: "framed_quote", value: "framed_quote" },
            { name: "divider", value: "divider" },
            { name: "code", value: "code" },
          ],
        },
      ],
    },
    {
      name: "schedule",
      description: "Owner only: schedule messages (one-time or repeating).",
      options: [
        {
          type: 1,
          name: "addtext",
          description: "Schedule text/media URLs to a channel.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel",
              required: true,
            },
            {
              type: 3,
              name: "when",
              description: "When to post: ISO/unix or relative like dd/hh/mm",
              required: true,
            },
            {
              type: 3,
              name: "message",
              description: "Message text (optional if media_urls provided)",
              required: false,
            },
            {
              type: 3,
              name: "media_urls",
              description: "Media URLs (comma or space separated)",
              required: false,
            },
            {
              type: 4,
              name: "repeat_minutes",
              description: "Repeat interval minutes (0 = one-time)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "addfrom",
          description: "Schedule from an existing Discord message link.",
          options: [
            {
              type: 3,
              name: "message_link",
              description: "Source Discord message link",
              required: true,
            },
            {
              type: 3,
              name: "when",
              description: "When to post: ISO/unix or relative like dd/hh/mm",
              required: true,
            },
            {
              type: 7,
              name: "channel",
              description: "Target channel (optional, default source channel)",
              required: false,
            },
            {
              type: 4,
              name: "repeat_minutes",
              description: "Repeat interval minutes (0 = one-time)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "list",
          description: "List schedules for this server.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Filter by channel",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "remove",
          description: "Delete a schedule by ID.",
          options: [
            {
              type: 4,
              name: "id",
              description: "Schedule ID",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "pause",
          description: "Pause a schedule by ID.",
          options: [
            {
              type: 4,
              name: "id",
              description: "Schedule ID",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "resume",
          description: "Resume a paused schedule by ID.",
          options: [
            {
              type: 4,
              name: "id",
              description: "Schedule ID",
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: "purge",
      description: "Owner only: purge messages and configure auto-purge.",
      options: [
        {
          type: 1,
          name: "media",
          description: "Purge recent media/attachment messages in a channel.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel",
              required: true,
            },
            {
              type: 4,
              name: "limit",
              description: "How many recent messages to scan (1-1000)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "nonadmin",
          description: "Purge recent messages by non-admin users in a channel.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel",
              required: true,
            },
            {
              type: 4,
              name: "limit",
              description: "How many recent messages to scan (1-1000)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "all",
          description: "Purge recent messages in a channel.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel",
              required: true,
            },
            {
              type: 4,
              name: "limit",
              description: "How many recent messages to scan (1-1000)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "autopurge_set",
          description: "Set/replace auto-purge rule for a channel.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Target channel",
              required: true,
            },
            {
              type: 4,
              name: "every",
              description: "Run every N units",
              required: true,
            },
            {
              type: 3,
              name: "unit",
              description: "Interval unit",
              required: false,
              choices: [
                { name: "seconds", value: "seconds" },
                { name: "minutes", value: "minutes" },
                { name: "hours", value: "hours" },
                { name: "days", value: "days" },
              ],
            },
            {
              type: 3,
              name: "mode",
              description: "What to purge each run",
              required: false,
              choices: [
                { name: "all", value: "all" },
                { name: "media", value: "media" },
                { name: "nonadmin", value: "nonadmin" },
              ],
            },
            {
              type: 4,
              name: "scan_limit",
              description: "Recent messages to scan each run (1-1000)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "autopurge_list",
          description: "List active auto-purge rules in this server.",
        },
        {
          type: 1,
          name: "autopurge_remove",
          description: "Remove auto-purge rule by ID.",
          options: [
            {
              type: 4,
              name: "id",
              description: "Rule ID from autopurge_list",
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: "welcome",
      description: "Configure join welcome message for this server (owner).",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set welcome channel + message template.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Where welcome messages should be posted",
              required: true,
            },
            {
              type: 3,
              name: "message",
              description:
                "Template. Use {user}, {guild}, and \\n. Example: Welcome {user} to {guild}!",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "show",
          description: "Show current welcome setup for this server.",
        },
        {
          type: 1,
          name: "preview",
          description: "Preview the current welcome message format.",
        },
        {
          type: 1,
          name: "clear",
          description: "Clear DB welcome config and fall back to .env.",
        },
      ],
    },
    {
      name: "mode",
      description: "Owner only: change bot personality mode.",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set the active bot mode.",
          options: [
            {
              type: 3,
              name: "name",
              description: "Mode name",
              required: true,
              choices: [
                { name: "sassy", value: "sassy" },
                { name: "chill", value: "chill" },
                { name: "serious", value: "serious" },
                { name: "hype", value: "hype" },
                { name: "rude", value: "rude" },
                { name: "ultraroast", value: "ultraroast" },
              ],
            },
          ],
        },
        {
          type: 1,
          name: "show",
          description: "Show current bot mode.",
        },
      ],
    },
    {
      name: "profile",
      description: "Manage your personal bot profile (opt-in).",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set/update your profile note (opt-in).",
          options: [
            {
              type: 3,
              name: "note",
              description: "Example: I'm GMT+8, I like Valorant, keep replies short",
              required: true,
            },
          ],
        },
        { type: 1, name: "show", description: "Show your profile." },
        { type: 1, name: "clear", description: "Delete your profile." },
        {
          type: 1,
          name: "peek",
          description: "Owner only: view someone else’s profile.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to view",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "setfor",
          description: "Owner only: set a profile note for a user.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to update",
              required: true,
            },
            {
              type: 3,
              name: "note",
              description: "Profile note to store for this user",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "clearfor",
          description: "Owner only: clear a user profile.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to clear",
              required: true,
            },
          ],
        },
      ],
    },
    { name: "Misfit: Summarize", type: ApplicationCommandType.Message },
    { name: "Misfit: Analyze Image", type: ApplicationCommandType.Message },
    { name: "Misfit: Transcribe Voice", type: ApplicationCommandType.Message },
    { name: "Misfit: Voice Note", type: ApplicationCommandType.Message },
    { name: "Misfit: Beautify Text", type: ApplicationCommandType.Message },
  ];
}

export function getHelpText() {
  return [
    "**MisfitBot commands** 😌",
    "",
    "**Tag me:**",
    "• `@MisfitBot <question>` — ask normally",
    "• Reply to an image/voice note and tag me — I’ll analyze/transcribe",
    "• Reply to text and tag me with `voicenote` or `voicenote nova`",
    "",
    "**Owner memory (Snooty only):**",
    "• `@MisfitBot mem set @User <notes>`",
    "• `@MisfitBot mem show @User`",
    "• `@MisfitBot mem forget @User`",
    "• `/welcome set channel:#channel message:<text>` (owner)",
    "• `/welcome show` / `/welcome preview` / `/welcome clear` (owner)",
    "• `/mode set name:<sassy|chill|serious|hype|rude|ultraroast>` / `/mode show` (owner)",
    "• `/schedule addtext|addfrom|list|remove|pause|resume` (owner)",
    "• `/purge media|nonadmin|all` and `/purge autopurge_set|autopurge_list|autopurge_remove` (owner)",
    "",
    "**Profiles (opt-in):**",
    "• `/profile set note:<text>`",
    "• `/profile show`",
    "• `/profile clear`",
    "• `/profile setfor user:@User note:<text>` (owner)",
    "• `/profile clearfor user:@User` (owner)",
    "",
    "**Slash:**",
    "• `/help`",
    "• `/ask prompt:<text> [message:<link>]`",
    "• `/summarize [message:<link>]`",
    "• `/explain [message:<link>]`",
    "• `/analyzeimage [message:<link>] [prompt:<text>]`",
    "• `/transcribe [message:<link>] [explain:true]`",
    "• `/imagine prompt:<text>`",
    "• `/summarizechannel count:<1-100>`",
    "• `/voicenote text:<text> [voice]`",
    "• `/beautify [text] [message:<link>] [style]`",
    "• Beautify styles: box, double_box, banner, wave, glitch, spaced, tinycaps, bubble, leet, shadow, matrix, staircase, framed_quote, divider, code",
    "• `/schedule when:` ISO UTC (`2026-02-14T21:30:00Z`), unix, `dd/hh/mm` (`01/02/30`), `hh/mm`, or `1d2h30m`",
    "• Purge note: Discord only bulk-deletes messages newer than 14 days",
    "• Auto-purge interval unit supports: seconds, minutes, hours, days",
    "",
    "**Right-click a message → Apps:**",
    "• Misfit: Summarize / Analyze Image / Transcribe Voice / Voice Note / Beautify Text",
  ].join("\n");
}

export async function registerCommands(client, commands) {
  try {
    // Cleanup step: remove legacy guild-scoped commands so global-only
    // registration does not appear duplicated in clients.
    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.commands.set([]);
        console.log(`🧹 Cleared guild-scoped commands: ${guild.id}`);
      } catch (err) {
        console.warn(`⚠️ Could not clear guild commands for ${guild.id}:`, err);
      }
    }

    await client.application.commands.set(commands);
    console.log("✅ Registered GLOBAL commands (may take time to appear)");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}
