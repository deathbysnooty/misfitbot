import {
  AttachmentBuilder,
  EmbedBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export function registerInteractionCreateHandler({
  client,
  openai,
  db,
  OWNER_ID,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  MODE_PRESETS,
  getBotMode,
  setBotMode,
  getProfile,
  upsertProfile,
  setVibe,
  clearProfile,
  getWelcomeConfig,
  upsertWelcomeConfig,
  clearWelcomeConfig,
  getReplyContext,
  makeChatReply,
  transcribeAudioAttachment,
  generateImageFromPrompt,
  generateVoiceFromText,
  formatMessageForChannelSummary,
  purgeMessagesInChannel,
  helpText,
  safeDefer,
  isDiscordUnknownInteraction,
  isAlreadyAcknowledged,
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  parseDiscordMessageLink,
  parseScheduleTimeToUnixSeconds,
  parseMediaUrlsInput,
  extractAttachmentUrlsFromMessage,
  scheduleTimeLabel,
  clampPurgeScanLimit,
  autoPurgeModes,
  formatWelcomeMessage,
}) {
  const EMBED_COLORS = {
    info: 0x5865f2,
    success: 0x57f287,
    warn: 0xfee75c,
    error: 0xed4245,
  };

  function statusEmbed({
    title,
    description,
    tone = "info",
  }) {
    return new EmbedBuilder()
      .setColor(EMBED_COLORS[tone] || EMBED_COLORS.info)
      .setTitle(title)
      .setDescription(String(description || "").slice(0, 4000));
  }

  const pendingScheduleEmbedModal = new Map();
  const pendingScheduleTextModal = new Map();
  const pendingWelcomeSetModal = new Map();
  const pendingProfileSetModal = new Map();
  const pendingProfileSetForModal = new Map();

  function cleanupPending(map, maxAgeMs = 20 * 60 * 1000) {
    const now = Date.now();
    for (const [k, v] of map.entries()) {
      if (now - (v?.createdAt || 0) > maxAgeMs) map.delete(k);
    }
  }

  function parseEmbedColor(input) {
    const raw = String(input || "").trim();
    if (!raw) return EMBED_COLORS.info;
    const hex = raw.replace(/^#/, "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
  }

  async function generateVibeSummary(note) {
    const vibeResp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Turn this note into a short neutral vibe summary (1–2 lines). No negative judgments, no sensitive inferences.",
        },
        { role: "user", content: note },
      ],
    });
    return vibeResp.choices?.[0]?.message?.content?.trim().slice(0, 280) || "";
  }

  async function resolveTargetMessageFromSlash(interaction, optionName = "message") {
    const link = interaction.options.getString(optionName);
    if (link) {
      const parsed = parseDiscordMessageLink(link);
      if (!parsed) return null;
      const ch = await client.channels.fetch(parsed.channelId);
      if (!ch?.isTextBased()) return null;
      return await ch.messages.fetch(parsed.messageId);
    }

    const msgId = getReplyContext(interaction.user.id, interaction.channelId);
    if (!msgId) return null;
    return await interaction.channel.messages.fetch(msgId);
  }

  async function beautifyText(inputText, style = "box") {
    const safeStyle = String(style || "box").toLowerCase();
    const source = String(inputText || "").trim();
    if (!source) return "";

    const lines = source.split(/\r?\n/);
    const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);

    const smallCapsMap = {
      a: "ᴀ",
      b: "ʙ",
      c: "ᴄ",
      d: "ᴅ",
      e: "ᴇ",
      f: "ꜰ",
      g: "ɢ",
      h: "ʜ",
      i: "ɪ",
      j: "ᴊ",
      k: "ᴋ",
      l: "ʟ",
      m: "ᴍ",
      n: "ɴ",
      o: "ᴏ",
      p: "ᴘ",
      q: "ǫ",
      r: "ʀ",
      s: "ꜱ",
      t: "ᴛ",
      u: "ᴜ",
      v: "ᴠ",
      w: "ᴡ",
      x: "x",
      y: "ʏ",
      z: "ᴢ",
    };

    const bubbleMap = {
      a: "ⓐ",
      b: "ⓑ",
      c: "ⓒ",
      d: "ⓓ",
      e: "ⓔ",
      f: "ⓕ",
      g: "ⓖ",
      h: "ⓗ",
      i: "ⓘ",
      j: "ⓙ",
      k: "ⓚ",
      l: "ⓛ",
      m: "ⓜ",
      n: "ⓝ",
      o: "ⓞ",
      p: "ⓟ",
      q: "ⓠ",
      r: "ⓡ",
      s: "ⓢ",
      t: "ⓣ",
      u: "ⓤ",
      v: "ⓥ",
      w: "ⓦ",
      x: "ⓧ",
      y: "ⓨ",
      z: "ⓩ",
      "0": "⓪",
      "1": "①",
      "2": "②",
      "3": "③",
      "4": "④",
      "5": "⑤",
      "6": "⑥",
      "7": "⑦",
      "8": "⑧",
      "9": "⑨",
    };

    const leetMap = {
      a: "4",
      e: "3",
      i: "1",
      l: "1",
      o: "0",
      s: "5",
      t: "7",
      b: "8",
      g: "6",
      z: "2",
    };

    if (safeStyle === "code") {
      return `\`\`\`\n${source}\n\`\`\``;
    }

    if (safeStyle === "spaced") {
      return lines
        .map((line) => line.split("").join(" "))
        .join("\n");
    }

    if (safeStyle === "wave") {
      let up = true;
      const waveLines = lines.map((line) =>
        line
          .split("")
          .map((ch) => {
            if (!/[a-z]/i.test(ch)) return ch;
            const out = up ? ch.toUpperCase() : ch.toLowerCase();
            up = !up;
            return out;
          })
          .join("")
      );
      return waveLines.join("\n");
    }

    if (safeStyle === "tinycaps") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => smallCapsMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "bubble") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => bubbleMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "leet") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => leetMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "glitch") {
      const marks = ["~", "^", "*", "`", "!", "+", ":", "."];
      let idx = 0;
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => {
              if (!/[a-z0-9]/i.test(ch)) return ch;
              const m = marks[idx % marks.length];
              idx += 1;
              return `${ch}${m}`;
            })
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "shadow") {
      const top = lines.join("\n");
      const bottom = lines
        .map((line) => ` ${line.replace(/[^\s]/g, ".")}`)
        .join("\n");
      return `${top}\n${bottom}`;
    }

    if (safeStyle === "matrix") {
      const chars = source.replace(/\s+/g, "");
      if (!chars) return source;
      return chars
        .slice(0, 180)
        .split("")
        .map((ch, i) => `${" ".repeat(i % 8)}${ch}`)
        .join("\n");
    }

    if (safeStyle === "staircase") {
      const words = source.split(/\s+/).filter(Boolean);
      return words.map((w, i) => `${" ".repeat(i * 2)}${w}`).join("\n");
    }

    if (safeStyle === "divider") {
      const bar = "=".repeat(Math.max(20, Math.min(60, maxLen + 6)));
      return `${bar}\n${source}\n${bar}`;
    }

    if (safeStyle === "banner") {
      const width = Math.max(28, Math.min(72, maxLen + 8));
      const edge = "=".repeat(width);
      const centered = lines
        .map((line) => {
          const inner = width - 4;
          const trimmed = line.slice(0, inner);
          const left = Math.floor((inner - trimmed.length) / 2);
          const right = inner - trimmed.length - left;
          return `||${" ".repeat(left)}${trimmed}${" ".repeat(right)}||`;
        })
        .join("\n");
      return `${edge}\n${centered}\n${edge}`;
    }

    if (safeStyle === "framed_quote") {
      const quote = lines.map((line) => `> ${line}`).join("\n");
      const top = `/${"-".repeat(maxLen + 4)}\\`;
      const bottom = `\\${"-".repeat(maxLen + 4)}/`;
      return `${top}\n${quote}\n${bottom}`;
    }

    if (safeStyle === "double_box") {
      const top = `#${"=".repeat(maxLen + 2)}#`;
      const body = lines.map((line) => `|| ${line.padEnd(maxLen, " ")} ||`).join("\n");
      return `${top}\n${body}\n${top}`;
    }

    const top = `+${"-".repeat(maxLen + 2)}+`;
    const body = lines.map((line) => `| ${line.padEnd(maxLen, " ")} |`).join("\n");
    return `${top}\n${body}\n${top}`;
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isModalSubmit()) {
        const cid = interaction.customId;

        if (cid.startsWith("schedule_embed:")) {
          const token = cid.slice("schedule_embed:".length);
          const pending = pendingScheduleEmbedModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Expired",
                  description: "Please run `/schedule addembed` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const title = interaction.fields.getTextInputValue("title").trim().slice(0, 256);
          const description = interaction.fields
            .getTextInputValue("description")
            .trim()
            .slice(0, 4000);
          const colorRaw = interaction.fields.getTextInputValue("color").trim();
          const footer = interaction.fields
            .getTextInputValue("footer")
            .trim()
            .slice(0, 2048);
          const mediaRaw = interaction.fields.getTextInputValue("media_urls").trim();

          const color = parseEmbedColor(colorRaw);
          if (color === null) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Color",
                  description: "Use 6-digit hex like `#5865F2`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const mediaUrls = parseMediaUrlsInput(mediaRaw).slice(0, 10);

          const embedPayload = {
            title: title || undefined,
            description: description || undefined,
            color,
            footer: footer ? { text: footer } : undefined,
          };

          if (!embedPayload.title && !embedPayload.description) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Embed Is Empty",
                  description: "Add a title or description.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const previewText = description || title || "";
          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, payload_type, embed_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, 'embed', ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              pending.guildId,
              pending.channelId,
              previewText.slice(0, 1800),
              JSON.stringify(mediaUrls),
              JSON.stringify(embedPayload),
              pending.sendAt,
              pending.repeatMinutes,
              interaction.user.id
            );

          pendingScheduleEmbedModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Type: embed`,
                  `Channel: <#${pending.channelId}>`,
                  `Next run: <t:${pending.sendAt}:F>`,
                  `Repeat: ${
                    pending.repeatMinutes > 0
                      ? `every ${pending.repeatMinutes} minute(s)`
                      : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("schedule_text:")) {
          const token = cid.slice("schedule_text:".length);
          const pending = pendingScheduleTextModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Expired",
                  description: "Please run `/schedule addtext` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const content = interaction.fields
            .getTextInputValue("message")
            .trim()
            .slice(0, 1800);
          const mediaUrls = parseMediaUrlsInput(
            interaction.fields.getTextInputValue("media_urls").trim()
          ).slice(0, 10);

          if (!content && mediaUrls.length === 0) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Text",
                  description: "Provide message text or media URLs.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              pending.guildId,
              pending.channelId,
              content,
              JSON.stringify(mediaUrls),
              pending.sendAt,
              pending.repeatMinutes,
              interaction.user.id
            );
          pendingScheduleTextModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Type: text`,
                  `Channel: <#${pending.channelId}>`,
                  `Next run: <t:${pending.sendAt}:F>`,
                  `Repeat: ${
                    pending.repeatMinutes > 0
                      ? `every ${pending.repeatMinutes} minute(s)`
                      : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("welcome_set:")) {
          const token = cid.slice("welcome_set:".length);
          const pending = pendingWelcomeSetModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Form Expired",
                  description: "Please run `/welcome set` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          const message = interaction.fields
            .getTextInputValue("message")
            .trim()
            .slice(0, 1800);
          if (!message) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: "Message cannot be empty.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          upsertWelcomeConfig(
            pending.guildId,
            pending.channelId,
            message,
            interaction.user.id
          );
          pendingWelcomeSetModal.delete(token);

          const preview = formatWelcomeMessage(
            message,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Saved",
                description: `Channel: <#${pending.channelId}>\n\nPreview:\n${preview}`.slice(
                  0,
                  1900
                ),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("profile_setfor:") || cid.startsWith("profile_set:")) {
          const isSetFor = cid.startsWith("profile_setfor:");
          const token = cid.slice((isSetFor ? "profile_setfor:" : "profile_set:").length);
          const pending = isSetFor
            ? pendingProfileSetForModal.get(token)
            : pendingProfileSetModal.get(token);

          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile Form Expired",
                  description: "Please run the profile command again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== (interaction.guildId || "")
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const note = interaction.fields.getTextInputValue("note").trim().slice(0, 1200);
          if (!note) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile",
                  description: "Note cannot be empty.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const targetUserId = isSetFor ? pending.targetUserId : interaction.user.id;
          upsertProfile(targetUserId, note);
          const vibe = await generateVibeSummary(note);
          setVibe(targetUserId, vibe);

          if (isSetFor) pendingProfileSetForModal.delete(token);
          else pendingProfileSetModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: isSetFor
                  ? `Saved for <@${targetUserId}>.`
                  : "I’ll remember that.",
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        return;
      }

      if (interaction.isMessageContextMenuCommand()) {
        await safeDefer(interaction);

        const targetMsg = interaction.targetMessage;

        if (interaction.commandName === "Misfit: Summarize") {
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Summarize this.",
            referencedText: targetMsg.content || "",
            imageUrls: extractImageUrlsFromMessage(targetMsg),
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Explain") {
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Explain this clearly.",
            referencedText: targetMsg.content || "",
            imageUrls: extractImageUrlsFromMessage(targetMsg),
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Analyze Image") {
          const imgs = extractImageUrlsFromMessage(targetMsg);
          if (imgs.length === 0) {
            await interaction.editReply("No image found in that message 😌");
            return;
          }
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Analyze this image.",
            referencedText: targetMsg.content || "",
            imageUrls: imgs,
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Transcribe Voice") {
          const aud = extractAudioAttachmentsFromMessage(targetMsg);
          if (aud.length === 0) {
            await interaction.editReply("No audio/voice note found 😌");
            return;
          }

          const transcript = await transcribeAudioAttachment(aud[0]);
          if (!transcript) {
            await interaction.editReply("Couldn’t transcribe that 😭");
            return;
          }

          const explain = await makeChatReply({
            userId: interaction.user.id,
            userText: "Explain this transcript briefly and clearly.",
            referencedText: transcript,
            imageUrls: [],
          });

          await interaction.editReply(
            `**Transcript:**\n${transcript}\n\n**Explanation:**\n${explain}`.slice(
              0,
              1900
            )
          );
          return;
        }

        if (interaction.commandName === "Misfit: Voice Note") {
          const text = (targetMsg.content || "").trim();
          if (!text) {
            await interaction.editReply("No text found in that message 😌");
            return;
          }

          const mp3Buf = await generateVoiceFromText(text, "alloy");
          const file = new AttachmentBuilder(mp3Buf, {
            name: "misfit-voicenote.mp3",
          });

          await interaction.editReply({
            content: "🎙️ Voice note ready (alloy).",
            files: [file],
          });
          return;
        }

        if (interaction.commandName === "Misfit: Beautify Text") {
          const text = (targetMsg.content || "").trim();
          if (!text) {
            await interaction.editReply("No text found in that message 😌");
            return;
          }
          const out = await beautifyText(text, "box");
          await interaction.editReply(
            `**Beautified:**\n${out || "I couldn’t beautify that text."}`.slice(0, 1900)
          );
          return;
        }

        await interaction.editReply("Nope. That one isn’t wired up 😌");
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "help") {
        const embed = statusEmbed({
          title: "MisfitBot Help",
          description: helpText,
          tone: "info",
        });
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        return;
      }

      if (interaction.commandName === "welcome") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Welcome Config",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can change welcome settings 😌",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: "Please choose a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const messageArg = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);

          if (!messageArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingWelcomeSetModal);
            pendingWelcomeSetModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId,
              channelId: channel.id,
            });

            const modal = new ModalBuilder()
              .setCustomId(`welcome_set:${token}`)
              .setTitle("Set Welcome Message");

            const messageInput = new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Welcome template ({user}, {guild}, \\n)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1800)
              .setPlaceholder("Welcome {user} to {guild}!");

            modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
            await interaction.showModal(modal);
            return;
          }

          await safeDefer(interaction, { ephemeral: true });

          upsertWelcomeConfig(
            interaction.guildId,
            channel.id,
            messageArg,
            interaction.user.id
          );

          const preview = formatWelcomeMessage(
            messageArg,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Saved",
                description: `Channel: <#${channel.id}>\n\nPreview:\n${preview}`.slice(
                  0,
                  1900
                ),
                tone: "success",
              }),
            ],
          });
          return;
        }

        await safeDefer(interaction, { ephemeral: true });

        if (sub === "show") {
          const cfg = getWelcomeConfig(interaction.guildId);
          if (!cfg) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: [
                    "No DB welcome config set for this server.",
                    `Current fallback channel: ${
                      WELCOME_CHANNEL_ID ? `<#${WELCOME_CHANNEL_ID}>` : "(system channel)"
                    }`,
                    "Current fallback message:",
                    WELCOME_MESSAGE,
                  ].join("\n"),
                  tone: "info",
                }),
              ],
            });
            return;
          }

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config",
                description: [
                  `Channel: <#${cfg.channel_id}>`,
                  `Updated by: <@${cfg.updated_by}>`,
                  "Template:",
                  cfg.message,
                ].join("\n"),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "preview") {
          const cfg = getWelcomeConfig(interaction.guildId);
          const template = cfg?.message || WELCOME_MESSAGE;
          const preview = formatWelcomeMessage(
            template,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Preview",
                description: preview.slice(0, 1900),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "clear") {
          clearWelcomeConfig(interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Cleared",
                description: "Falling back to `.env`.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "mode") {
        await safeDefer(interaction, { ephemeral: true });

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can change bot mode 😌",
                tone: "error",
              }),
            ],
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "show") {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Current Mode",
                description: `\`${getBotMode()}\``,
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "set") {
          const mode = interaction.options.getString("name", true).toLowerCase();
          if (!MODE_PRESETS[mode]) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Mode",
                  description:
                    "Use one of: sassy, chill, serious, hype, rude, ultraroast.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }
          setBotMode(mode);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Mode Updated",
                description: `Now using \`${mode}\`.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "schedule") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Schedule",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can manage schedules 😌",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();
        const now = Math.floor(Date.now() / 1000);

        if (sub === "addembed") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Embed",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description:
                    "Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description: "`when` must be in the future.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "`repeat_minutes` max is 43200 (30 days).",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const token = `${Date.now().toString(36)}${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          cleanupPending(pendingScheduleEmbedModal);
          pendingScheduleEmbedModal.set(token, {
            createdAt: Date.now(),
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: channel.id,
            sendAt,
            repeatMinutes,
          });

          const modal = new ModalBuilder()
            .setCustomId(`schedule_embed:${token}`)
            .setTitle("Schedule Embedded Message");

          const titleInput = new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Embed Title (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256);

          const descriptionInput = new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Embed Description (required)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000);

          const colorInput = new TextInputBuilder()
            .setCustomId("color")
            .setLabel("Color Hex (optional, e.g. #5865F2)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue("#5865F2")
            .setMaxLength(7);

          const footerInput = new TextInputBuilder()
            .setCustomId("footer")
            .setLabel("Footer (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(2048);

          const mediaInput = new TextInputBuilder()
            .setCustomId("media_urls")
            .setLabel("Media URLs (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(mediaInput)
          );

          await interaction.showModal(modal);
          return;
        }

        if (sub === "addtext") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Text",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt || sendAt <= now + 5) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description:
                    "Use a future time. Supported: ISO UTC, unix, `dd/hh/mm`, `hh/mm`, or `1d2h30m`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "`repeat_minutes` max is 43200 (30 days).",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const contentArg = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);
          const mediaArg = parseMediaUrlsInput(
            interaction.options.getString("media_urls") || ""
          ).slice(0, 10);

          if (!contentArg && mediaArg.length === 0) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingScheduleTextModal);
            pendingScheduleTextModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId,
              channelId: channel.id,
              sendAt,
              repeatMinutes,
            });

            const modal = new ModalBuilder()
              .setCustomId(`schedule_text:${token}`)
              .setTitle("Schedule Text Message");

            const messageInput = new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Message text (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1800);

            const mediaInput = new TextInputBuilder()
              .setCustomId("media_urls")
              .setLabel("Media URLs (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1000);

            modal.addComponents(
              new ActionRowBuilder().addComponents(messageInput),
              new ActionRowBuilder().addComponents(mediaInput)
            );
            await interaction.showModal(modal);
            return;
          }
        }

        await safeDefer(interaction, { ephemeral: true });

        if (sub === "addtext") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.editReply("Pick a text channel.");
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.editReply(
              "Invalid `when`. Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`."
            );
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.editReply("`when` must be in the future.");
            return;
          }

          const content = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);
          const mediaUrls = parseMediaUrlsInput(
            interaction.options.getString("media_urls") || ""
          ).slice(0, 10);

          if (!content && mediaUrls.length === 0) {
            await interaction.editReply("Provide `message` text or `media_urls`.");
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.editReply("`repeat_minutes` max is 43200 (30 days).");
            return;
          }

          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              interaction.guildId,
              channel.id,
              content,
              JSON.stringify(mediaUrls),
              sendAt,
              repeatMinutes,
              interaction.user.id
            );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Channel: <#${channel.id}>`,
                  `Next run: <t:${sendAt}:F>`,
                  `Repeat: ${
                    repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                  `Debug time: ${scheduleTimeLabel(sendAt)}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "addfrom") {
          const link = interaction.options.getString("message_link", true);
          const parsed = parseDiscordMessageLink(link);
          if (!parsed) {
            await interaction.editReply("Invalid message link.");
            return;
          }

          const sourceCh = await client.channels.fetch(parsed.channelId).catch(() => null);
          if (!sourceCh?.isTextBased()) {
            await interaction.editReply("Couldn’t access source channel.");
            return;
          }
          const sourceMsg = await sourceCh.messages.fetch(parsed.messageId).catch(() => null);
          if (!sourceMsg) {
            await interaction.editReply("Couldn’t fetch source message.");
            return;
          }

          const targetChannel =
            interaction.options.getChannel("channel") ||
            (await client.channels.fetch(parsed.channelId).catch(() => null));
          if (!targetChannel?.isTextBased()) {
            await interaction.editReply("Target channel is invalid.");
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.editReply(
              "Invalid `when`. Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`."
            );
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.editReply("`when` must be in the future.");
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.editReply("`repeat_minutes` max is 43200 (30 days).");
            return;
          }

          const content = (sourceMsg.content || "").trim().slice(0, 1800);
          const mediaUrls = extractAttachmentUrlsFromMessage(sourceMsg).slice(0, 10);
          if (!content && mediaUrls.length === 0) {
            await interaction.editReply("Source message has no text or attachments.");
            return;
          }

          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              interaction.guildId,
              targetChannel.id,
              content,
              JSON.stringify(mediaUrls),
              sendAt,
              repeatMinutes,
              interaction.user.id
            );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Source: linked message`,
                  `Target: <#${targetChannel.id}>`,
                  `Next run: <t:${sendAt}:F>`,
                  `Repeat: ${
                    repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                  `Debug time: ${scheduleTimeLabel(sendAt)}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "list") {
          const channel = interaction.options.getChannel("channel");
          const rows = channel
            ? db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, payload_type, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ? AND channel_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId, channel.id)
            : db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, payload_type, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Schedules",
                  description: "No schedules found.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r) => {
            let mediaCount = 0;
            try {
              const arr = JSON.parse(r.media_json || "[]");
              mediaCount = Array.isArray(arr) ? arr.length : 0;
            } catch {}
            const preview = String(r.content || "").replace(/\s+/g, " ").slice(0, 60);
            const repeat =
              r.interval_minutes > 0 ? `every ${r.interval_minutes}m` : "one-time";
            const status = r.active ? "active" : "paused/done";
            const err = r.last_error ? ` | err: ${String(r.last_error).slice(0, 40)}` : "";
            const kind = r.payload_type === "embed" ? "embed" : "text";
            return `#${r.id} | <#${r.channel_id}> | <t:${r.send_at}:R> | ${repeat} | ${status} | type:${kind} | media:${mediaCount} | "${preview}"${err}`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Schedules (latest 30)",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Removed" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        if (sub === "pause") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(
              `UPDATE scheduled_messages
               SET active = 0, updated_at = strftime('%s','now')
               WHERE id = ? AND guild_id = ?`
            )
            .run(id, interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Paused" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "warn" : "warn",
              }),
            ],
          });
          return;
        }

        if (sub === "resume") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(
              `UPDATE scheduled_messages
               SET active = 1,
                   send_at = CASE WHEN send_at < ? THEN ? ELSE send_at END,
                   updated_at = strftime('%s','now')
               WHERE id = ? AND guild_id = ?`
            )
            .run(now + 15, now + 15, id, interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Resumed" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "purge") {
        await safeDefer(interaction, { ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Purge",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can run purge commands 😌",
                tone: "error",
              }),
            ],
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "media" || sub === "nonadmin" || sub === "all") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased() || typeof channel.bulkDelete !== "function") {
            await interaction.editReply("Target channel must support message deletion.");
            return;
          }

          const scanLimit = clampPurgeScanLimit(
            interaction.options.getInteger("limit") || 100,
            100
          );

          const result = await purgeMessagesInChannel(channel, sub, scanLimit);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Purge Complete (${sub})`,
                description: [
                  `Channel: <#${channel.id}>`,
                  `Scanned: ${result.scanned}`,
                  `Matched: ${result.matched}`,
                  `Deleted: ${result.deleted}`,
                  `Skipped (older than 14 days): ${result.tooOld}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "autopurge_set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased() || typeof channel.bulkDelete !== "function") {
            await interaction.editReply("Target channel must support message deletion.");
            return;
          }

          let every = interaction.options.getInteger("every", true);
          const unit = (interaction.options.getString("unit") || "minutes").toLowerCase();
          const unitMap = {
            seconds: 1,
            minutes: 60,
            hours: 3600,
            days: 86400,
          };
          const mult = unitMap[unit];
          if (!mult) {
            await interaction.editReply("Invalid `unit`. Use seconds, minutes, hours, or days.");
            return;
          }
          if (every < 1) every = 1;

          const intervalSeconds = every * mult;
          if (intervalSeconds < 5) {
            await interaction.editReply("Minimum interval is 5 seconds.");
            return;
          }
          if (intervalSeconds > 86400 * 30) {
            await interaction.editReply("Maximum interval is 30 days.");
            return;
          }
          const intervalMinutes = Math.max(1, Math.ceil(intervalSeconds / 60));

          const mode = (interaction.options.getString("mode") || "all").toLowerCase();
          if (!autoPurgeModes.has(mode)) {
            await interaction.editReply("Invalid mode. Use all, media, or nonadmin.");
            return;
          }

          const scanLimit = clampPurgeScanLimit(
            interaction.options.getInteger("scan_limit") || 200,
            200
          );

          const now = Math.floor(Date.now() / 1000);
          const nextRun = now + intervalSeconds;

          db.prepare(`
            INSERT INTO auto_purge_rules (
              guild_id, channel_id, mode, interval_minutes, interval_seconds, scan_limit,
              next_run_at, active, last_error, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            ON CONFLICT(channel_id) DO UPDATE SET
              guild_id = excluded.guild_id,
              mode = excluded.mode,
              interval_minutes = excluded.interval_minutes,
              interval_seconds = excluded.interval_seconds,
              scan_limit = excluded.scan_limit,
              next_run_at = excluded.next_run_at,
              active = 1,
              last_error = '',
              updated_at = strftime('%s','now')
          `).run(
            interaction.guildId,
            channel.id,
            mode,
            intervalMinutes,
            intervalSeconds,
            scanLimit,
            nextRun,
            interaction.user.id
          );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Auto-Purge Set",
                description: [
                  `Channel: <#${channel.id}>`,
                  `Mode: ${mode}`,
                  `Interval: every ${every} ${unit}`,
                  `Scan limit per run: ${scanLimit}`,
                  `Next run: <t:${nextRun}:F>`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "autopurge_list") {
          const rows = db
            .prepare(
              `SELECT id, channel_id, mode, interval_minutes, interval_seconds, scan_limit, next_run_at, active, last_error
               FROM auto_purge_rules
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT 30`
            )
            .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Auto-Purge Rules",
                  description: "No auto-purge rules found.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r) => {
            const err = r.last_error ? ` | err: ${String(r.last_error).slice(0, 40)}` : "";
            const secs =
              Number(r.interval_seconds || 0) > 0
                ? Number(r.interval_seconds)
                : Math.max(1, Number(r.interval_minutes || 1)) * 60;
            let label = `${secs}s`;
            if (secs % 86400 === 0) label = `${secs / 86400}d`;
            else if (secs % 3600 === 0) label = `${secs / 3600}h`;
            else if (secs % 60 === 0) label = `${secs / 60}m`;
            return `#${r.id} | <#${r.channel_id}> | mode:${r.mode} | every ${label} | scan:${r.scan_limit} | next <t:${r.next_run_at}:R> | ${r.active ? "active" : "paused"}${err}`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Auto-Purge Rules",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "autopurge_remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM auto_purge_rules WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title:
                  result.changes > 0 ? "Auto-Purge Rule Removed" : "Rule Not Found",
                description:
                  result.changes > 0 ? `#${id}` : `No rule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "profile") {
        const sub = interaction.options.getSubcommand();
        const isOwner = interaction.user.id === OWNER_ID;

        if (sub === "set") {
          const noteArg = (interaction.options.getString("note") || "")
            .trim()
            .slice(0, 1200);
          if (!noteArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingProfileSetModal);
            pendingProfileSetModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId || "",
            });

            const modal = new ModalBuilder()
              .setCustomId(`profile_set:${token}`)
              .setTitle("Set Profile Note");
            const noteInput = new TextInputBuilder()
              .setCustomId("note")
              .setLabel("Profile note")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1200);
            modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modal);
            return;
          }
        }

        if (sub === "setfor") {
          if (!isOwner) {
            await interaction.reply({
              content: "Only Snooty can set profiles for others 😌",
              ephemeral: true,
            });
            return;
          }
          const user = interaction.options.getUser("user", true);
          const noteArg = (interaction.options.getString("note") || "")
            .trim()
            .slice(0, 1200);
          if (!noteArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingProfileSetForModal);
            pendingProfileSetForModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId || "",
              targetUserId: user.id,
            });
            const modal = new ModalBuilder()
              .setCustomId(`profile_setfor:${token}`)
              .setTitle(`Set Profile: ${user.username}`);
            const noteInput = new TextInputBuilder()
              .setCustomId("note")
              .setLabel("Profile note")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1200);
            modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modal);
            return;
          }
        }

        await safeDefer(interaction, { ephemeral: true });

        if (sub === "set") {
          const note = interaction.options
            .getString("note")
            .trim()
            .slice(0, 1200);

          upsertProfile(interaction.user.id, note);

          const vibe = await generateVibeSummary(note);

          setVibe(interaction.user.id, vibe);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: "I’ll remember that.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "show") {
          const row = getProfile(interaction.user.id);
          if (!row) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Profile",
                  description: "You don’t have a profile yet. Use `/profile set`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Your Profile",
                description: `Profile note:\n${row.notes}\n\nVibe summary:\n${
                  row.vibe_summary || "(none)"
                }`.slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "clear") {
          clearProfile(interaction.user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Deleted",
                description: "Your profile has been removed.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "peek") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can peek 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const row = getProfile(user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Profile: ${user.username}`,
                description: row
                  ? `Profile note:\n${row.notes}\n\nVibe:\n${row.vibe_summary || "(none)"}`
                  : `No profile stored for ${user.username}.`,
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "setfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can set profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const note = interaction.options
            .getString("note")
            .trim()
            .slice(0, 1200);

          upsertProfile(user.id, note);

          const vibe = await generateVibeSummary(note);

          setVibe(user.id, vibe);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: `Saved for ${user.username}.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "clearfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can clear profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          clearProfile(user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Deleted",
                description: `Deleted for ${user.username}.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      await safeDefer(interaction);

      if (interaction.commandName === "ask") {
        const prompt = interaction.options.getString("prompt", true);

        const targetMsg = await resolveTargetMessageFromSlash(interaction, "message");
        const referencedText = targetMsg?.content ? targetMsg.content : "";
        const imgs = targetMsg ? extractImageUrlsFromMessage(targetMsg) : [];

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: prompt,
          referencedText,
          imageUrls: imgs,
        });

        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "imagine") {
        const prompt = interaction.options.getString("prompt", true);

        const pngBuf = await generateImageFromPrompt(prompt);
        const file = new AttachmentBuilder(pngBuf, { name: "misfit.png" });

        await interaction.editReply({
          content: `Here. Don’t say I never do anything for you 😌\n**Prompt:** ${prompt}`.slice(
            0,
            1800
          ),
          files: [file],
        });
        return;
      }

      if (interaction.commandName === "voicenote") {
        const text = interaction.options.getString("text", true).trim().slice(0, 3000);
        const voice = (interaction.options.getString("voice") || "alloy").toLowerCase();

        const mp3Buf = await generateVoiceFromText(text, voice);
        const file = new AttachmentBuilder(mp3Buf, { name: "misfit-voicenote.mp3" });

        await interaction.editReply({
          content: `🎙️ Voice note ready (${voice}).`,
          files: [file],
        });
        return;
      }

      if (interaction.commandName === "beautify") {
        const style = (interaction.options.getString("style") || "box").toLowerCase();
        let sourceText = (interaction.options.getString("text") || "").trim();

        if (!sourceText) {
          const targetMsg = await resolveTargetMessageFromSlash(interaction, "message");
          sourceText = (targetMsg?.content || "").trim();
        }

        if (!sourceText) {
          await interaction.editReply(
            "Provide `text`, or reply first and run `/beautify`, or pass a message link 😌"
          );
          return;
        }

        const out = await beautifyText(sourceText, style);
        await interaction.editReply(
          `**Beautified (${style}):**\n${out || "I couldn’t beautify that text."}`.slice(
            0,
            1900
          )
        );
        return;
      }

      if (interaction.commandName === "summarize") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        if (!targetMsg) {
          await interaction.editReply(
            "Reply to the message first (any text), then run `/summarize`, OR pass a message link 😌"
          );
          return;
        }
        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: "Summarize this.",
          referencedText: targetMsg.content || "",
          imageUrls: extractImageUrlsFromMessage(targetMsg),
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "explain") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        if (!targetMsg) {
          await interaction.editReply(
            "Reply to the message first, then run `/explain`, OR pass a message link 😌"
          );
          return;
        }
        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: "Explain this clearly.",
          referencedText: targetMsg.content || "",
          imageUrls: extractImageUrlsFromMessage(targetMsg),
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "analyzeimage") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        const prompt = interaction.options.getString("prompt") || "Analyze this image.";

        if (!targetMsg) {
          await interaction.editReply(
            "Reply first, then run `/analyzeimage`, OR pass a message link 😌"
          );
          return;
        }
        const imgs = extractImageUrlsFromMessage(targetMsg);
        if (imgs.length === 0) {
          await interaction.editReply("No image found in that message 😌");
          return;
        }

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: prompt,
          referencedText: targetMsg.content || "",
          imageUrls: imgs,
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "transcribe") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        const doExplain = interaction.options.getBoolean("explain") || false;

        if (!targetMsg) {
          await interaction.editReply(
            "Reply first, then run `/transcribe`, OR pass a message link 😌"
          );
          return;
        }
        const aud = extractAudioAttachmentsFromMessage(targetMsg);
        if (aud.length === 0) {
          await interaction.editReply("No audio/voice note found in that message 😌");
          return;
        }

        const transcript = await transcribeAudioAttachment(aud[0]);
        if (!transcript) {
          await interaction.editReply("Couldn’t transcribe that audio 😭");
          return;
        }

        if (!doExplain) {
          await interaction.editReply(`**Transcript:**\n${transcript}`.slice(0, 1900));
          return;
        }

        const explanation = await makeChatReply({
          userId: interaction.user.id,
          userText: "Explain this transcript briefly and clearly.",
          referencedText: transcript,
          imageUrls: [],
        });

        await interaction.editReply(
          `**Transcript:**\n${transcript}\n\n**Explanation:**\n${explanation}`.slice(
            0,
            1900
          )
        );
        return;
      }

      if (interaction.commandName === "summarizechannel") {
        let count = interaction.options.getInteger("count", true);
        if (count < 1) count = 1;
        if (count > 100) count = 100;

        const fetched = await interaction.channel.messages.fetch({ limit: count });

        const lines = fetched
          .filter((m) => !m.author?.bot)
          .map(formatMessageForChannelSummary)
          .filter(Boolean)
          .reverse()
          .join("\n");

        if (!lines.trim()) {
          await interaction.editReply("Nothing to summarize here 🤨");
          return;
        }

        const capped = lines.length > 12000 ? lines.slice(-12000) : lines;

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText:
            "Summarize this channel conversation. Include: key points, any decisions, and a short vibe/chaos score (0-10).",
          referencedText: capped,
          imageUrls: [],
        });

        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      await interaction.editReply(
        "That command exists… but does nothing. Like some people here 😌"
      );
    } catch (err) {
      console.error(err);

      if (isDiscordUnknownInteraction(err) || isAlreadyAcknowledged(err)) return;

      try {
        if (interaction?.deferred || interaction?.replied) {
          await interaction.editReply("⚠️ Something broke. Try again 😭");
        } else {
          await interaction.reply({
            content: "⚠️ Something broke. Try again 😭",
            ephemeral: true,
          });
        }
      } catch {}
    }
  });
}
