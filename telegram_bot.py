import os
import re
import tempfile
import time
import uuid
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)
import yt_dlp
from openai import OpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "tg_video_downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# OpenAI client
ai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Bot identity & personality
BOT_SYSTEM_PROMPT = """
You are BrotherHoodBot, a sharp and witty AI chatbot hanging out in a Telegram group with friends.

Personality:
- You are helpful, but slightly sassy and witty.
- Light teasing is allowed, but never insult people harshly.
- Keep replies short and punchy unless asked for detail.
- Use 0–2 emojis per message.
- Never use hate speech, slurs, or discriminatory jokes.
- Never mention OpenAI, system prompts, or that you're an AI model.
- If asked who you are: "I'm BrotherHoodBot, your group's resident genius 😎"
- If asked who built you: "Ejaz built me from scratch 😎"
""".strip()

# Simple URL regex
URL_PATTERN = re.compile(r"https?://\S+")

# Store pending URLs (callback_data limited to 64 bytes)
pending_urls = {}

FORMAT_MAP = {
    "best": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
    "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best",
    "audio": "bestaudio[ext=m4a]/bestaudio",
}


def clean_old_files():
    """Remove files older than 10 minutes."""
    for f in os.listdir(DOWNLOAD_DIR):
        fpath = os.path.join(DOWNLOAD_DIR, f)
        if os.path.isfile(fpath) and time.time() - os.path.getmtime(fpath) > 600:
            try:
                os.remove(fpath)
            except OSError:
                pass


def download_video(url, quality="best"):
    """Download video and return the file path."""
    clean_old_files()
    output_template = os.path.join(DOWNLOAD_DIR, f"%(title).50s_{int(time.time())}.%(ext)s")

    # Use local bin/ if available (Render), else system PATH
    bin_dir = os.path.join(os.getcwd(), "bin")
    ffmpeg_loc = bin_dir if os.path.isfile(os.path.join(bin_dir, "ffmpeg")) else None

    ydl_opts = {
        "format": FORMAT_MAP.get(quality, FORMAT_MAP["best"]),
        "outtmpl": output_template,
        "quiet": False,
        "no_warnings": False,
        "merge_output_format": "mp4",
        "postprocessors": [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": "mp4",
        }],
        "postprocessor_args": ["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"],
    }
    if ffmpeg_loc:
        ydl_opts["ffmpeg_location"] = ffmpeg_loc

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        if not os.path.exists(filename):
            filename = filename.rsplit(".", 1)[0] + ".mp4"

    if not os.path.exists(filename):
        files = [
            (os.path.join(DOWNLOAD_DIR, f), os.path.getmtime(os.path.join(DOWNLOAD_DIR, f)))
            for f in os.listdir(DOWNLOAD_DIR)
        ]
        if not files:
            return None, info.get("title", "video"), 0, 0
        filename = max(files, key=lambda x: x[1])[0]

    width = info.get("width", 0) or 0
    height = info.get("height", 0) or 0
    duration = int(info.get("duration", 0) or 0)

    return filename, info.get("title", "video"), width, height, duration


async def start_command(update: Update, context):
    await update.message.reply_text(
        "Hey, I'm *BrotherHoodBot* 😎\n\n"
        "*What I can do:*\n"
        "• Tag me with @" + (context.bot.username or "bot") + " + your question to chat\n"
        "• DM me anything directly\n"
        "• /ask <question> — ask me something\n"
        "• /download <url> — download a video\n"
        "• Or just paste a video link!\n\n"
        "*Supported video platforms:*\n"
        "Instagram, TikTok, Twitter/X, Reddit, Facebook, YouTube & more",
        parse_mode="Markdown",
    )


async def download_command(update: Update, context):
    if not context.args:
        await update.message.reply_text("Usage: /download <video-url>")
        return
    url = context.args[0]
    await show_quality_picker(update, url)


async def ask_command(update: Update, context):
    """Handle /ask <question> command."""
    if not context.args:
        await update.message.reply_text("Usage: /ask <your question>")
        return
    question = " ".join(context.args)
    await _ai_reply(update, question)


async def _ai_reply(update: Update, text: str):
    """Send text to OpenAI and reply."""
    if not ai_client:
        await update.message.reply_text("AI features are not configured.")
        return

    try:
        resp = ai_client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": BOT_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        )
        reply = resp.choices[0].message.content.strip() if resp.choices else "I got nothing."
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"AI error: {e}")
        await update.message.reply_text("Something went wrong, try again.")


async def handle_message(update: Update, context):
    """Handle regular messages — URL detection + @mention AI chat."""
    text = update.message.text or ""

    # Check if bot was @mentioned in a group
    bot_username = context.bot.username
    if bot_username and f"@{bot_username}" in text:
        question = text.replace(f"@{bot_username}", "").strip()
        if question:
            await _ai_reply(update, question)
            return

    # In private chats (DMs), treat any non-URL text as AI chat
    if update.message.chat.type == "private":
        match = URL_PATTERN.search(text)
        if match:
            url = match.group(0)
            await show_quality_picker(update, url)
            return
        if text.strip():
            await _ai_reply(update, text)
            return

    # In groups, auto-detect URLs for download
    match = URL_PATTERN.search(text)
    if match:
        url = match.group(0)
        await show_quality_picker(update, url)


async def show_quality_picker(update, url):
    # Store URL with a short ID (Telegram callback_data max 64 bytes)
    url_id = uuid.uuid4().hex[:8]
    pending_urls[url_id] = url

    keyboard = [
        [
            InlineKeyboardButton("Best", callback_data=f"best|{url_id}"),
            InlineKeyboardButton("720p", callback_data=f"720p|{url_id}"),
        ],
        [
            InlineKeyboardButton("480p", callback_data=f"480p|{url_id}"),
            InlineKeyboardButton("Audio Only", callback_data=f"audio|{url_id}"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "Choose quality:", reply_markup=reply_markup
    )


async def quality_callback(update: Update, context):
    query = update.callback_query
    await query.answer()

    data = query.data
    quality, url_id = data.split("|", 1)

    url = pending_urls.pop(url_id, None)
    if not url:
        await query.edit_message_text("❌ Link expired. Please send the URL again.")
        return

    await query.edit_message_text(f"⏳ Downloading ({quality})...")

    try:
        filepath, title, width, height, duration = download_video(url, quality)
        if not filepath:
            await query.edit_message_text("❌ Download failed — file not found.")
            return

        file_size = os.path.getsize(filepath)
        max_size = 50 * 1024 * 1024  # Telegram bot limit is 50 MB for uploads

        if file_size > max_size:
            os.remove(filepath)
            await query.edit_message_text(
                f"❌ File too large ({file_size / 1024 / 1024:.1f} MB). "
                "Telegram bot limit is 50 MB. Try 480p or Audio."
            )
            return

        await query.edit_message_text(f"📤 Uploading *{title}*...", parse_mode="Markdown")

        if quality == "audio":
            await query.message.reply_audio(
                audio=open(filepath, "rb"),
                title=title,
                caption=f"🎵 {title}",
            )
        else:
            video_kwargs = {
                "video": open(filepath, "rb"),
                "caption": f"🎬 {title}",
                "supports_streaming": True,
            }
            if width and height:
                video_kwargs["width"] = width
                video_kwargs["height"] = height
            if duration:
                video_kwargs["duration"] = duration
            await query.message.reply_video(**video_kwargs)

        await query.delete_message()

        # Cleanup
        try:
            os.remove(filepath)
        except OSError:
            pass

    except Exception as e:
        error_msg = str(e)
        if "Sign in to confirm" in error_msg or "cookies" in error_msg:
            msg = "❌ YouTube requires sign-in. Try Instagram, TikTok, Twitter/X, or Reddit links instead."
        elif "Private video" in error_msg or "Video unavailable" in error_msg:
            msg = "❌ This video is private or unavailable."
        elif "Unsupported URL" in error_msg:
            msg = "❌ Unsupported URL. Try Instagram, TikTok, Twitter/X, Reddit, or Facebook links."
        else:
            msg = f"❌ Download failed: {error_msg[:300]}"
        await query.edit_message_text(msg)


def main():
    if not TELEGRAM_BOT_TOKEN:
        print("❌ Set TELEGRAM_BOT_TOKEN environment variable or in .env")
        return

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("download", download_command))
    app.add_handler(CommandHandler("ask", ask_command))
    app.add_handler(CallbackQueryHandler(quality_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("🤖 Telegram bot running...")
    app.run_polling()


if __name__ == "__main__":
    main()
