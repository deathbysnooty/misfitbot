#!/bin/sh

# Start Telegram bot in background (only if token is set)
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  echo "🤖 Starting Telegram bot..."
  python3 telegram_bot.py &
fi

# Start Discord bot (main process)
echo "🎮 Starting Discord bot..."
exec node index.mjs
