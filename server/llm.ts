// The apps' own model calls: structured decisions the avatar cannot hand back
// (the Avatar API has no function calling), such as "which city did the user
// guess" or "what does this photo show". Gemini, JSON out.
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export interface StructuredRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;   // a JSON schema (Gemini's responseSchema subset)
  images?: { mimeType: string; base64: string }[];
  temperature?: number;
}

export const llmAvailable = () => Boolean(KEY);

export async function structured<T>(req: StructuredRequest): Promise<T> {
  if (!KEY) throw new Error('GEMINI_API_KEY is not set');
  const parts: unknown[] = [{ text: req.user }];
  for (const image of req.images ?? []) parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: req.schema, temperature: req.temperature ?? 0.2 },
    }),
  });
  const json: any = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`${MODEL}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return JSON.parse(text) as T;
}
