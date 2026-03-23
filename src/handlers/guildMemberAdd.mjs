export function registerGuildMemberAddHandler({
  client,
  featuresPaused,
  getWelcomeConfig,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  formatWelcomeMessage,
}) {
  client.on("guildMemberAdd", async (member) => {
    try {
      if (featuresPaused) return;

      const cfg = getWelcomeConfig(member.guild.id);
      const selectedChannelId = cfg?.channel_id || "";
      const configuredChannel = selectedChannelId
        ? await member.guild.channels.fetch(selectedChannelId).catch(() => null)
        : null;

      const targetChannel =
        configuredChannel && configuredChannel.isTextBased()
          ? configuredChannel
          : member.guild.systemChannel && member.guild.systemChannel.isTextBased()
            ? member.guild.systemChannel
            : null;

      if (!targetChannel) return;

      const welcomeText = formatWelcomeMessage(
        cfg?.message || WELCOME_MESSAGE,
        member.guild.name,
        member.id,
        WELCOME_MESSAGE
      );

      await targetChannel.send(welcomeText);
    } catch (err) {
      console.error("Welcome message failed:", err);
    }
  });
}
