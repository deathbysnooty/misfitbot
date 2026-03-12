import { execSync } from "node:child_process";
import { existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

const binDir = join(process.cwd(), "bin");
execSync(`mkdir -p ${binDir}`);

const ytdlp = join(binDir, "yt-dlp");
const ffmpeg = join(binDir, "ffmpeg");

// Download yt-dlp standalone binary
if (!existsSync(ytdlp)) {
  console.log("⬇️  Downloading yt-dlp...");
  execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o ${ytdlp}`);
  chmodSync(ytdlp, 0o755);
  console.log("✅ yt-dlp installed");
} else {
  console.log("✅ yt-dlp already exists");
}

// Download static ffmpeg build
if (!existsSync(ffmpeg)) {
  console.log("⬇️  Downloading ffmpeg...");
  execSync(`curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz`);
  execSync(`tar -xf /tmp/ffmpeg.tar.xz -C /tmp`);
  execSync(`cp /tmp/ffmpeg-*-amd64-static/ffmpeg ${ffmpeg}`);
  execSync(`cp /tmp/ffmpeg-*-amd64-static/ffprobe ${join(binDir, "ffprobe")}`);
  chmodSync(ffmpeg, 0o755);
  chmodSync(join(binDir, "ffprobe"), 0o755);
  execSync("rm -rf /tmp/ffmpeg*");
  console.log("✅ ffmpeg installed");
} else {
  console.log("✅ ffmpeg already exists");
}

console.log("🎬 All download dependencies ready in ./bin/");

// Install Python telegram bot deps
console.log("⬇️  Installing Python dependencies for Telegram bot...");
try {
  execSync("pip3 install --break-system-packages --user python-telegram-bot yt-dlp 2>&1 || pip install --user python-telegram-bot yt-dlp 2>&1", { stdio: "inherit" });
  console.log("✅ Python deps installed");
} catch (e) {
  console.log("⚠️  Python deps install failed (Telegram bot may not work):", e.message);
}
