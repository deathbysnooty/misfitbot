import fs from "node:fs";
import fsp from "node:fs/promises";

function defaultIdeasPath() {
  return String(process.env.IDEAS_FILE_PATH || "./ideas.json").trim();
}

function normalizeIdeas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      id: Number(item?.id || 0),
      text: String(item?.text || "").trim(),
      expanded: String(item?.expanded || "").trim(),
      timestamp: String(item?.timestamp || "").trim(),
    }))
    .filter((item) => item.id > 0 && item.text);
}

export function createIdeasService({ openai }) {
  const filePath = defaultIdeasPath();

  async function ensureFile() {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
    } catch {
      await fsp.writeFile(filePath, "[]\n", "utf8");
    }
  }

  async function loadIdeas() {
    await ensureFile();
    try {
      const raw = await fsp.readFile(filePath, "utf8");
      return normalizeIdeas(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  async function saveIdeas(items) {
    await fsp.writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }

  async function expandIdea(text) {
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content:
            "You help run IB Tuition Centre in Singapore. Expand rough business ideas into a practical mini-plan. Keep it concise and useful. Write exactly three short paragraphs or lines covering: immediate action, content angle, longer-term possibility.",
        },
        {
          role: "user",
          content: `Expand this idea for a private business dashboard workflow:\n\n${text}`,
        },
      ],
    });

    return (
      resp.choices?.[0]?.message?.content?.trim() ||
      "Immediate action: define the smallest next step.\nContent angle: turn this into one practical post or note.\nLonger-term possibility: evolve it into a repeatable workflow."
    ).slice(0, 1600);
  }

  async function addIdea(text) {
    const cleanText = String(text || "").trim().slice(0, 800);
    if (!cleanText) throw new Error("Idea text cannot be empty.");

    const ideas = await loadIdeas();
    const expanded = await expandIdea(cleanText);
    const nextId = ideas.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const timestamp = new Date().toISOString();
    const entry = {
      id: nextId,
      text: cleanText,
      expanded,
      timestamp,
    };

    ideas.push(entry);
    await saveIdeas(ideas);
    return entry;
  }

  async function listIdeas(limit = 10) {
    const ideas = await loadIdeas();
    return ideas.slice(-Math.max(1, Math.min(25, Number(limit) || 10))).reverse();
  }

  return {
    addIdea,
    listIdeas,
    filePath,
  };
}
