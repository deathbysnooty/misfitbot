import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

export function extractImageUrlsFromMessage(msg) {
  const urls = [];
  if (!msg?.attachments) return urls;

  for (const [, att] of msg.attachments) {
    const ct = (att.contentType || "").toLowerCase();
    const name = (att.name || "").toLowerCase();

    const isImage =
      ct.startsWith("image/") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".gif");

    if (isImage && att.url) urls.push(att.url);
  }
  return urls;
}

export function extractAudioAttachmentsFromMessage(msg) {
  const atts = [];
  if (!msg?.attachments) return atts;

  for (const [, att] of msg.attachments) {
    const ct = (att.contentType || "").toLowerCase();
    const name = (att.name || "").toLowerCase();

    const looksLikeVoiceNote =
      name.includes("voice") ||
      name.includes("audio") ||
      name.includes("recording");

    const isAudio =
      ct.startsWith("audio/") ||
      ct.includes("ogg") ||
      ct.includes("opus") ||
      ct.includes("webm") ||
      ct.includes("mpeg") ||
      ct.includes("mp4") ||
      ct.includes("octet-stream") ||
      name.endsWith(".mp3") ||
      name.endsWith(".wav") ||
      name.endsWith(".m4a") ||
      name.endsWith(".mp4") ||
      name.endsWith(".ogg") ||
      name.endsWith(".webm");

    if ((isAudio || looksLikeVoiceNote) && att.url) {
      atts.push({
        url: att.url,
        name: att.name || "",
        contentType: att.contentType || "",
      });
    }
  }
  return atts;
}

export function parseDiscordMessageLink(input) {
  const m = input?.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

export function extFromContentType(ct) {
  const s = (ct || "").toLowerCase();
  if (s.includes("ogg") || s.includes("opus")) return ".ogg";
  if (s.includes("webm")) return ".webm";
  if (s.includes("mpeg")) return ".mp3";
  if (s.includes("wav")) return ".wav";
  if (s.includes("mp4") || s.includes("m4a")) return ".m4a";
  return "";
}

export function extFromUrl(u) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    const m = p.match(/\.(mp3|wav|m4a|mp4|ogg|webm)$/);
    return m ? `.${m[1]}` : "";
  } catch {
    return "";
  }
}

export function extFromName(name) {
  const n = (name || "").toLowerCase();
  const m = n.match(/\.(mp3|wav|m4a|mp4|ogg|webm)$/);
  return m ? `.${m[1]}` : "";
}

export async function downloadToTemp(url, desiredExt = ".bin") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const tmpDir = path.join(process.cwd(), "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${crypto.randomUUID()}${desiredExt}`);
  await fsp.writeFile(filePath, buf);
  return filePath;
}

export function isDiscordUnknownInteraction(err) {
  return (
    err?.code === 10062 ||
    String(err?.message || "").includes("Unknown interaction")
  );
}

export function isAlreadyAcknowledged(err) {
  return (
    err?.code === 40060 ||
    String(err?.message || "").includes("already been acknowledged")
  );
}

export async function safeDefer(interaction, opts = {}) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(opts);
}

export function extractAttachmentUrlsFromMessage(msg) {
  const urls = [];
  if (!msg?.attachments) return urls;
  for (const [, att] of msg.attachments) {
    if (att?.url) urls.push(att.url);
  }
  return urls;
}

export function parseMediaUrlsInput(raw) {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  for (const part of parts) {
    try {
      const u = new URL(part);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.href);
    } catch {}
  }
  return out;
}

export function parseScheduleTimeToUnixSeconds(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const now = Math.floor(Date.now() / 1000);

  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return raw.length === 13 ? Math.floor(n / 1000) : n;
  }

  // Relative shorthand from now:
  // - "dd/hh/mm" (e.g. "01/02/30" => 1 day, 2 hours, 30 minutes)
  // - "hh/mm" (e.g. "02/45" => 2 hours, 45 minutes)
  // - token form like "1d2h30m", "45m", "10s"
  if (/^\d{1,3}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [d, h, m] = raw.split("/").map((v) => Number(v));
    if (![d, h, m].every(Number.isFinite)) return null;
    const offset = d * 86400 + h * 3600 + m * 60;
    return offset > 0 ? now + offset : null;
  }
  if (/^\d{1,3}\/\d{1,2}$/.test(raw)) {
    const [h, m] = raw.split("/").map((v) => Number(v));
    if (![h, m].every(Number.isFinite)) return null;
    const offset = h * 3600 + m * 60;
    return offset > 0 ? now + offset : null;
  }
  if (/^(\d+\s*[dhms]\s*)+$/i.test(raw)) {
    const re = /(\d+)\s*([dhms])/gi;
    let total = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
      const n = Number(match[1]);
      const u = match[2].toLowerCase();
      if (!Number.isFinite(n)) return null;
      if (u === "d") total += n * 86400;
      if (u === "h") total += n * 3600;
      if (u === "m") total += n * 60;
      if (u === "s") total += n;
    }
    return total > 0 ? now + total : null;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(`${raw.replace(" ", "T")}:00Z`);
    const t = Math.floor(d.getTime() / 1000);
    return Number.isFinite(t) ? t : null;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

export function scheduleTimeLabel(unixSec) {
  try {
    return new Date(unixSec * 1000).toISOString();
  } catch {
    return String(unixSec);
  }
}

export function clampPurgeScanLimit(n, fallback = 100) {
  let v = Number(n || fallback);
  if (!Number.isFinite(v)) v = fallback;
  if (v < 1) v = 1;
  if (v > 1000) v = 1000;
  return Math.floor(v);
}

export function formatWelcomeMessage(template, guildName, memberId, fallbackMessage) {
  return (template || fallbackMessage)
    .replaceAll("{user}", `<@${memberId}>`)
    .replaceAll("{guild}", guildName)
    .replace(/<(\d{17,20})>/g, "<#$1>")
    .replaceAll("\\n", "\n");
}
