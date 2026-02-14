function decodeOpenTdbText(value) {
  const raw = String(value || "");
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function normalizeKey(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createTriviaService({
  fetchImpl = globalThis.fetch,
  batchSize = 20,
  minRefillSize = 5,
} = {}) {
  let token = "";
  let queue = [];
  let inflight = null;

  async function ensureToken() {
    if (token) return token;
    const res = await fetchImpl("https://opentdb.com/api_token.php?command=request");
    if (!res?.ok) throw new Error("OpenTDB token request failed");
    const data = await res.json();
    token = String(data?.token || "").trim();
    if (!token) throw new Error("OpenTDB token missing");
    return token;
  }

  async function refill() {
    if (inflight) return inflight;

    inflight = (async () => {
      const t = await ensureToken();
      let res = await fetchImpl(
        `https://opentdb.com/api.php?amount=${batchSize}&type=multiple&token=${encodeURIComponent(t)}&encode=url3986`
      );
      if (!res?.ok) throw new Error("OpenTDB fetch failed");
      let data = await res.json();

      if (Number(data?.response_code) === 4) {
        const reset = await fetchImpl(
          `https://opentdb.com/api_token.php?command=reset&token=${encodeURIComponent(t)}`
        );
        if (!reset?.ok) throw new Error("OpenTDB token reset failed");
        res = await fetchImpl(
          `https://opentdb.com/api.php?amount=${batchSize}&type=multiple&token=${encodeURIComponent(t)}&encode=url3986`
        );
        if (!res?.ok) throw new Error("OpenTDB fetch failed after reset");
        data = await res.json();
      }

      const results = Array.isArray(data?.results) ? data.results : [];
      const mapped = results
        .map((r) => {
          const question = decodeOpenTdbText(r?.question);
          const answer = decodeOpenTdbText(r?.correct_answer);
          if (!question || !answer) return null;
          return {
            question,
            answer,
            aliases: [],
            explanation: "",
            source: "Open Trivia DB",
            questionKey: normalizeKey(question),
          };
        })
        .filter(Boolean);

      queue = queue.concat(mapped);
    })();

    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  async function getQuestion({ avoidQuestionKeys = [] } = {}) {
    const avoid = new Set(
      (Array.isArray(avoidQuestionKeys) ? avoidQuestionKeys : [])
        .map((v) => normalizeKey(v))
        .filter(Boolean)
    );

    if (queue.length < minRefillSize) {
      try {
        await refill();
      } catch {
        // Keep fallback behavior in caller.
      }
    }

    while (queue.length) {
      const q = queue.shift();
      if (!q?.questionKey) continue;
      if (avoid.has(q.questionKey)) continue;
      return q;
    }

    return null;
  }

  return {
    getQuestion,
  };
}
