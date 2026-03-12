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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "tg_video_downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

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
        "🎬 *Video Downloader Bot*\n\n"
        "Send me any video link and I'll download it for you.\n\n"
        "*Supported platforms:*\n"
        "Instagram, TikTok, Twitter/X, Reddit, Facebook, YouTube & more\n\n"
        "*Commands:*\n"
        "/download <url> — download a video\n"
        "Or just paste a link directly!",
        parse_mode="Markdown",
    )


async def download_command(update: Update, context):
    if not context.args:
        await update.message.reply_text("Usage: /download <video-url>")
        return
    url = context.args[0]
    await show_quality_picker(update, url)


async def handle_message(update: Update, context):
    """Auto-detect URLs in messages."""
    text = update.message.text or ""
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
    app.add_handler(CallbackQueryHandler(quality_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("🤖 Telegram bot running...")
    app.run_polling()


if __name__ == "__main__":
    main()
