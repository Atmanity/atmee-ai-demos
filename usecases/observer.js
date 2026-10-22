// The presence use case's eyes: describe a screen frame and say whether
// something noteworthy changed since the last description. Gemini when a key
// is set; otherwise a stub that only reports "the screen changed", so the rest
// of the loop still runs.
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function describeFrame(dataUrl, previous, hint) {
  if (!dataUrl) throw new Error("image is required");
  if (!KEY) return { description: hint || "the screen changed", noteworthy: previous ? "the screen changed" : null, model: "stub" };
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const prompt = `You are the eyes of a quiet companion avatar sitting next to someone who is working at a computer. This is a screenshot of their screen${hint ? ` (the app says: ${hint})` : ""}.
Previous description: ${previous || "(none)"}.
Answer as JSON only: {"description": one sentence of what the user is doing now, "noteworthy": null or one short sentence naming the one thing worth a companion's remark (an error, a finished task, a long pause, switching to something unrelated, something funny)}. Routine progress is not noteworthy.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
  });
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`observer: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  const parsed = JSON.parse(text);
  return { description: String(parsed.description || "").slice(0, 300), noteworthy: parsed.noteworthy ? String(parsed.noteworthy).slice(0, 200) : null, model: MODEL };
}
