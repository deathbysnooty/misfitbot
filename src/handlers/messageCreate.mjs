import { AttachmentBuilder } from "discord.js";

export function registerMessageCreateHandler({
  client,
  OWNER_ID,
  db,
  setUserMemory,
  clearUserMemory,
  ai,
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  setReplyContext,
  parseScheduleTimeToUnixSeconds,
  parseIntervalToSeconds,
  formatIntervalLabel,
}) {
  function extractImageUrlsForGuard(msg) {
    const urls = [];

    if (msg?.attachments?.size) {
      for (const [, att] of msg.attachments) {
        const ct = String(att?.contentType || "").toLowerCase();
        const name = String(att?.name || "").toLowerCase();
        const isImage =
          ct.startsWith("image/") ||
          /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
        if (isImage && att?.url) urls.push(att.url);
      }
    }

    const s = String(msg?.content || "");
    const re = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp)(?:\?\S*)?/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
      urls.push(m[0]);
    }

    return [...new Set(urls)].slice(0, 3);
  }

  const disabledReplyChannelIds = new Set(
    String(process.env.DISABLE_REPLY_CHANNEL_IDS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;

      if (message.guildId) {
        const guard = db
          .prepare(
            `SELECT active, mode
             FROM nsfw_media_guard_rules
             WHERE guild_id = ? AND channel_id = ? AND active = 1`
          )
          .get(message.guildId, message.channel.id);

        if (guard) {
          const isAdmin = Boolean(message.member?.permissions?.has("Administrator"));
          if (!isAdmin) {
            const mode = String(guard.mode || "adult_only").toLowerCase();
            if (mode === "adult_only") {
              const imageUrls = extractImageUrlsForGuard(message);
              if (imageUrls.length > 0) {
                let adultFound = false;
                for (const imageUrl of imageUrls) {
                  const flagged = await ai.isLikelyAdultImage(imageUrl);
                  if (flagged) {
                    adultFound = true;
                    break;
                  }
                }

                if (adultFound) {
                  await message.delete().catch(() => null);
                  await message.channel
                    .send(
                      `🚫 <@${message.author.id}> adult/NSFW media is not allowed in this channel.`
                    )
                    .then((m) => setTimeout(() => m.delete().catch(() => null), 8000))
                    .catch(() => null);
                  return;
                }
              }
            }
          }
        }
      }

      if (message.reference?.messageId) {
        setReplyContext(
          message.author.id,
          message.channel.id,
          message.reference.messageId
        );
      }

      // In blocked channels, ignore normal reply/mention behavior.
      if (disabledReplyChannelIds.has(message.channel.id)) return;

      const raw = message.content.toLowerCase().trim();
      if (/^bruh+h*$/.test(raw)) {
        await message.reply("bruh indeed 😭");
        return;
      }

      if (!message.mentions.has(client.user)) return;

      const isOwner = message.author.id === OWNER_ID;

      const userText = message.content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();

      let referencedText = "";
      let repliedMsg = null;

      if (message.reference?.messageId) {
        try {
          repliedMsg = await message.channel.messages.fetch(
            message.reference.messageId
          );
          if (repliedMsg?.content) referencedText = repliedMsg.content.trim();
        } catch {}
      }

      let imageUrls = extractImageUrlsFromMessage(message);
      let audioAtts = extractAudioAttachmentsFromMessage(message);

      if (repliedMsg) {
        imageUrls = imageUrls.concat(extractImageUrlsFromMessage(repliedMsg));
        audioAtts = audioAtts.concat(
          extractAudioAttachmentsFromMessage(repliedMsg)
        );
      }

      imageUrls = imageUrls.slice(0, 3);
      audioAtts = audioAtts.slice(0, 1);

      const setMatch = userText.match(/^mem\s+set\s+<@!?(\d+)>\s+(.+)$/i);
      if (setMatch) {
        if (!isOwner) {
          return void (await message.reply(
            "Nice try. Only Snooty can edit memory 😌"
          ));
        }
        const targetId = setMatch[1];
        const notes = setMatch[2].trim();

        setUserMemory(targetId, notes);

        await message.reply(`Got it. I’ll remember that about <@${targetId}> 🧠`);
        return;
      }

      const showMatch = userText.match(/^mem\s+show\s+<@!?(\d+)>$/i);
      if (showMatch) {
        if (!isOwner) {
          return void (await message.reply(
            "Only Snooty can view other people’s memory 😌"
          ));
        }
        const targetId = showMatch[1];
        const row = db
          .prepare(`SELECT notes FROM user_memory WHERE user_id = ?`)
          .get(targetId);
        await message.reply(
          row?.notes
            ? `Memory for <@${targetId}>:\n${row.notes}`
            : `I have nothing stored for <@${targetId}> yet.`
        );
        return;
      }

      const forgetMatch = userText.match(/^mem\s+forget\s+<@!?(\d+)>$/i);
      if (forgetMatch) {
        if (!isOwner) {
          return void (await message.reply("Only Snooty can wipe memory 😈"));
        }
        const targetId = forgetMatch[1];
        clearUserMemory(targetId);
        await message.reply(`Memory wiped for <@${targetId}> 🧽`);
        return;
      }

      const reminderMatch = userText.match(
        /^remind\s+me\s+(.+?)\s+to\s+(.+?)(?:\s+every\s+(.+))?$/i
      );
      if (reminderMatch) {
        let whenRaw = reminderMatch[1].trim();
        const reminderMessage = reminderMatch[2].trim().slice(0, 1800);
        const everyRaw = (reminderMatch[3] || "").trim();

        whenRaw = whenRaw.replace(/^(in|at)\s+/i, "").trim();
        const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
        const now = Math.floor(Date.now() / 1000);
        if (!sendAt || sendAt <= now + 2) {
          await message.reply(
            "I couldn’t parse that reminder time. Try `in 10m`, `01/02/30`, `1d2h`, unix, or ISO UTC."
          );
          return;
        }
        if (!reminderMessage) {
          await message.reply("Reminder message cannot be empty.");
          return;
        }

        let intervalSeconds = 0;
        if (everyRaw) {
          intervalSeconds = parseIntervalToSeconds(everyRaw);
          if (intervalSeconds < 5) {
            await message.reply(
              "Repeat interval is too short. Use at least 5 seconds (e.g. `every 10m`)."
            );
            return;
          }
          if (intervalSeconds > 86400 * 30) {
            await message.reply("Repeat interval max is 30 days.");
            return;
          }
        }

        const result = db
          .prepare(
            `INSERT INTO user_reminders (
               user_id, guild_id, message, send_at, interval_seconds, active, last_error, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, 1, '', strftime('%s','now'), strftime('%s','now'))`
          )
          .run(
            message.author.id,
            message.guild?.id || "0",
            reminderMessage,
            sendAt,
            intervalSeconds
          );

        await message.reply(
          [
            `⏰ Reminder set (#${result.lastInsertRowid})`,
            `When: <t:${sendAt}:F>`,
            `Repeat: ${formatIntervalLabel(intervalSeconds)}`,
            "I will DM you when it triggers.",
          ].join("\n")
        );
        return;
      }

      const voiceFromReplyMatch = userText.match(
        /^voice(?:\s*note)?(?:\s+(alloy|nova|onyx|echo|fable|shimmer))?$/i
      );
      if (voiceFromReplyMatch && repliedMsg) {
        const text = (repliedMsg.content || "").trim();
        if (!text) {
          await message.reply("That replied message has no text to read 😌");
          return;
        }

        const voice = (voiceFromReplyMatch[1] || "alloy").toLowerCase();
        await message.channel.sendTyping();
        try {
          const mp3Buf = await ai.generateVoiceFromText(text, voice);
          const file = new AttachmentBuilder(mp3Buf, {
            name: "misfit-voicenote.mp3",
          });
          await message.reply({
            content: `🎙️ Voice note ready (${voice}).`,
            files: [file],
          });
        } catch (e) {
          console.error("Voice note (mention/reply) failed:", e);
          await message.reply("⚠️ I couldn’t generate that voice note 😭");
        }
        return;
      }

      if (!userText && audioAtts.length > 0) {
        await message.channel.sendTyping();
        try {
          const transcript = await ai.transcribeAudioAttachment(audioAtts[0]);
          const explanation = await ai.makeChatReply({
            userId: message.author.id,
            userText: "Explain this transcript briefly and clearly.",
            referencedText: transcript || "(empty transcript)",
            imageUrls: [],
          });

          await message.reply(
            `**Transcript:**\n${(transcript || "—").slice(
              0,
              1400
            )}\n\n**Explanation:**\n${explanation}`.slice(0, 1900)
          );
        } catch (e) {
          console.error("Transcribe (mention) failed:", e);
          await message.reply("⚠️ I couldn’t transcribe that voice note 😭");
        }
        return;
      }

      const finalText =
        userText && userText.length > 0
          ? userText
          : imageUrls.length > 0
            ? "Analyze this image."
            : "";

      if (!finalText) {
        await message.reply("Tag me with a question 😌");
        return;
      }

      await message.channel.sendTyping();
      try {
        const reply = await ai.makeChatReply({
          userId: message.author.id,
          userText: finalText,
          referencedText,
          imageUrls,
        });
        await message.reply(reply.slice(0, 1900));
      } catch (e) {
        console.error("Chat (mention) failed:", e);
        await message.reply("⚠️ Error generating a reply.");
      }
    } catch (err) {
      console.error(err);
    }
  });
}
