function decodeOpenTdbText(value) {
  const raw = String(value || "");
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function normalizeKey(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shuffleArray(input) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createTriviaService({
  fetchImpl = globalThis.fetch,
  batchSize = 20,
  minRefillSize = 5,
} = {}) {
  let token = "";
  const queues = new Map(); // sourceKey -> question[]
  const inflightByKey = new Map(); // sourceKey -> promise

  const CATEGORY_MAP = {
    mixed: "",
    random: "",
    history: "history",
    politics: "society_and_culture",
    sports: "sport_and_leisure",
    harry_potter: "film_and_tv",
    game_of_thrones: "film_and_tv",
    lord_of_the_rings: "arts_and_literature",
    movies: "film_and_tv",
    tv_show: "film_and_tv",
    celebrity_news: "society_and_culture",
    music: "music",
  };

  function resolveCategoryKey(category) {
    const c = String(category || "mixed").toLowerCase();
    return CATEGORY_MAP[c] ?? "";
  }

  function getQueue(sourceKey) {
    const key = sourceKey || "mixed";
    if (!queues.has(key)) queues.set(key, []);
    return queues.get(key);
  }

  async function ensureToken() {
    if (token) return token;
    const res = await fetchImpl("https://opentdb.com/api_token.php?command=request");
    if (!res?.ok) throw new Error("OpenTDB token request failed");
    const data = await res.json();
    token = String(data?.token || "").trim();
    if (!token) throw new Error("OpenTDB token missing");
    return token;
  }

  async function fetchOpenTdbBatch({ amount, type = "" }) {
    const t = await ensureToken();
    const qs = new URLSearchParams({
      amount: String(amount),
      token: t,
      encode: "url3986",
    });
    if (type) qs.set("type", type);

    let res = await fetchImpl(`https://opentdb.com/api.php?${qs.toString()}`);
    if (!res?.ok) throw new Error("OpenTDB fetch failed");
    let data = await res.json();

    if (Number(data?.response_code) === 4) {
      const reset = await fetchImpl(
        `https://opentdb.com/api_token.php?command=reset&token=${encodeURIComponent(t)}`
      );
      if (!reset?.ok) throw new Error("OpenTDB token reset failed");
      res = await fetchImpl(`https://opentdb.com/api.php?${qs.toString()}`);
      if (!res?.ok) throw new Error("OpenTDB fetch failed after reset");
      data = await res.json();
    }

    return Array.isArray(data?.results) ? data.results : [];
  }

  function mapOpenTdbResults(results = []) {
    return results
      .map((r) => {
        const question = decodeOpenTdbText(r?.question);
        const answer = decodeOpenTdbText(r?.correct_answer);
        if (!question || !answer) return null;
        const incorrect = Array.isArray(r?.incorrect_answers)
          ? r.incorrect_answers.map((v) => decodeOpenTdbText(v)).filter(Boolean)
          : [];
        const allOptions = shuffleArray([answer, ...incorrect]).slice(0, 4);
        const correctIndex = Math.max(0, allOptions.findIndex((v) => v === answer));
        return {
          question,
          answer,
          aliases: [],
          options: allOptions,
          correctIndex,
          explanation: "",
          source: "Open Trivia DB",
          questionType: String(r?.type || "").toLowerCase(),
          questionKey: normalizeKey(question),
        };
      })
      .filter(Boolean);
  }

  async function fetchTriviaApiBatch({ amount, categoryKey = "" }) {
    const qs = new URLSearchParams({
      limit: String(Math.max(1, amount)),
      types: "text_choice",
    });
    if (categoryKey) qs.set("categories", categoryKey);
    const res = await fetchImpl(`https://the-trivia-api.com/v2/questions?${qs.toString()}`);
    if (!res?.ok) throw new Error("TheTriviaAPI fetch failed");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  function mapTriviaApiResults(results = []) {
    return results
      .map((r) => {
        const question = decodeHtmlEntities(
          r?.question?.text ?? r?.question ?? ""
        );
        const answer = decodeHtmlEntities(r?.correctAnswer || "");
        if (!question || !answer) return null;

        const incorrect = Array.isArray(r?.incorrectAnswers)
          ? r.incorrectAnswers.map((v) => decodeHtmlEntities(v)).filter(Boolean)
          : [];
        const allOptions = shuffleArray([answer, ...incorrect]).slice(0, 4);
        const correctIndex = Math.max(0, allOptions.findIndex((v) => v === answer));

        return {
          question,
          answer,
          aliases: [],
          options: allOptions,
          correctIndex,
          explanation: "",
          source: "The Trivia API",
          questionType: "multiple",
          questionKey: normalizeKey(question),
        };
      })
      .filter(Boolean);
  }

  async function refill({ category = "mixed" } = {}) {
    const categoryKey = resolveCategoryKey(category);
    const queueKey = categoryKey || "mixed";
    if (inflightByKey.has(queueKey)) return inflightByKey.get(queueKey);

    const task = (async () => {
      const targetQueue = getQueue(queueKey);
      let mapped = [];

      // Default online source: The Trivia API (works for mixed and mapped categories).
      try {
        const tApiResults = await fetchTriviaApiBatch({
          amount: batchSize,
          categoryKey: categoryKey || "",
        });
        mapped = mapTriviaApiResults(tApiResults);
      } catch {
        mapped = [];
      }

      if (!mapped.length) {
        try {
          const results = await fetchOpenTdbBatch({ amount: batchSize });
          const booleanInPrimary = results.some((r) => String(r?.type || "") === "boolean");
          if (!booleanInPrimary) {
            try {
              const boolResults = await fetchOpenTdbBatch({
                amount: Math.max(2, Math.floor(batchSize / 4)),
                type: "boolean",
              });
              results.push(...boolResults);
            } catch {
              // Keep primary results if boolean fetch fails.
            }
          }
          mapped = mapOpenTdbResults(results);
        } catch {
          mapped = [];
        }
      }

      targetQueue.push(...mapped);
    })();

    inflightByKey.set(queueKey, task);
    try {
      await task;
    } finally {
      inflightByKey.delete(queueKey);
    }
  }

  async function getQuestion({ avoidQuestionKeys = [], category = "mixed" } = {}) {
    const avoid = new Set(
      (Array.isArray(avoidQuestionKeys) ? avoidQuestionKeys : [])
        .map((v) => normalizeKey(v))
        .filter(Boolean)
    );
    const categoryKey = resolveCategoryKey(category);
    const queueKey = categoryKey || "mixed";
    const queue = getQueue(queueKey);

    if (queue.length < minRefillSize) {
      try {
        await refill({ category });
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
