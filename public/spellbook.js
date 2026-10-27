// Silverfell's spellbook: the six schools of magic, their spells and sigils,
// and how a cast is judged. A plain script with no imports, so the spellcraft
// page loads it with a <script> tag and its tests import it the same way; it
// touches neither the page nor the network and sets globalThis.Spellbook.
//
//   Spellbook.SCHOOLS[key]          { name, color, glow, deep, virtue, effect, spells: [2] }
//   Spellbook.SIGILS[kind]          { label, path() } with path points in a unit square (y down)
//   Spellbook.schoolOf(text)        "Ember", "fire", "the ember school" -> "ember", else null
//   Spellbook.spellIndex(key, ref)  "Ignis Vela", "1", "the second" -> 0 or 1, else -1
//   Spellbook.rankOf(text)          "adept" -> "Adept", else null
//   Spellbook.length(points)                  a stroke's length, in circle widths
//   Spellbook.scoreTrace(stroke, kind)        0-100: how true a traced stroke is to the sigil (0 under 0.25 long)
//   Spellbook.similarity(heard, incantation)  0-1: how closely recent speech holds the words
//   Spellbook.castPower(accuracy, spoken)     the cast's power, 0-100
//   Spellbook.tier(power)                     brilliant, solid, shaky or fizzled
(function () {
  const TAU = Math.PI * 2;
  const deg = (d) => (d * Math.PI) / 180;
  const arc = (cx, cy, r, a0, a1, n) =>
    Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const curve = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  const quad = (p0, c, p1) => curve(32, (t) => { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });

  // Every sigil is one unbroken stroke in a unit square, drawn from its first point.
  const SIGILS = {
    triangle: { label: "a triangle pointing up", path: () => [[0.16, 0.84], [0.5, 0.14], [0.84, 0.84], [0.16, 0.84]] },
    circle: { label: "a full circle", path: () => arc(0.5, 0.5, 0.36, -Math.PI / 2, 1.5 * Math.PI, 64) },
    wave: { label: "a wave with two crests", path: () => curve(64, (t) => [0.1 + 0.8 * t, 0.5 - 0.2 * Math.sin(TAU * 2 * t)]) },
    chevron: { label: "two peaks, like an M", path: () => [[0.16, 0.8], [0.32, 0.2], [0.5, 0.58], [0.68, 0.2], [0.84, 0.8]] },
    bolt: { label: "a lightning bolt", path: () => [[0.64, 0.08], [0.3, 0.52], [0.62, 0.5], [0.36, 0.92]] },
    spiral: { label: "a spiral curling inward", path: () => curve(96, (t) => { const a = -Math.PI / 2 + t * TAU * 2.25, r = 0.4 - 0.34 * t; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; }) },
    diamond: { label: "a diamond, like a seed", path: () => [[0.5, 0.1], [0.8, 0.5], [0.5, 0.9], [0.2, 0.5], [0.5, 0.1]] },
    infinity: { label: "an endless loop, an 8 lying on its side", path: () => curve(96, (t) => { const a = t * TAU, d = 1 + Math.sin(a) ** 2; return [0.5 + (0.4 * Math.cos(a)) / d, 0.5 + (0.4 * Math.sin(a) * Math.cos(a)) / d]; }) },
    // The outer arc round the left, then the inner arc back: a circle through both tips and (0.4, 0.5).
    crescent: { label: "a crescent moon", path: () => [...arc(0.5, 0.5, 0.38, deg(60), deg(300), 40), ...arc(0.733, 0.5, 0.333, deg(262.6), deg(97.4), 32).slice(1)] },
    square: { label: "a square", path: () => [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]] },
    star: { label: "a five-pointed star in one stroke", path: () => [0, 2, 4, 1, 3, 0].map((k) => { const a = -Math.PI / 2 + (k * TAU) / 5; return [0.5 + 0.4 * Math.cos(a), 0.53 + 0.4 * Math.sin(a)]; }) },
    lens: { label: "an eye: two arcs meeting at the corners", path: () => [...quad([0.1, 0.5], [0.5, 0.1], [0.9, 0.5]), ...quad([0.9, 0.5], [0.5, 0.9], [0.1, 0.5]).slice(1)] },
  };

  // Two spells per school, taught in this order. The words are Silverfell's own.
  const SCHOOLS = {
    ember: { name: "Ember", color: "#ff6a3d", glow: "#ffc061", deep: "#3d0c05", virtue: "courage and warmth", effect: "flame", spells: [
      { name: "Ignis Vela", say: "IG-nis VAY-la", sigil: "triangle", does: "kindles a small flame that floats beside you, for light and warmth" },
      { name: "Pyra Corona", say: "PIE-ra co-RO-na", sigil: "circle", does: "throws a ring of fire around you that nothing cold can cross" },
    ] },
    tide: { name: "Tide", color: "#3d8fef", glow: "#9edcff", deep: "#071c38", virtue: "healing and calm", effect: "ripple", spells: [
      { name: "Maris Lenis", say: "MAR-is LAY-nis", sigil: "wave", does: "a cool mist that soothes a burn and slows a racing heart" },
      { name: "Unda Surgat", say: "OON-da SOOR-gat", sigil: "chevron", does: "raises a wave that washes a path clear" },
    ] },
    gale: { name: "Gale", color: "#e9c24c", glow: "#fff4b8", deep: "#2e2405", virtue: "speed and wit", effect: "swirl", spells: [
      { name: "Aura Celer", say: "OW-ra KEL-er", sigil: "bolt", does: "a gust that carries a message, or your feet, swift as a swallow" },
      { name: "Turbo Plumae", say: "TOOR-bo PLOO-my", sigil: "spiral", does: "a whirlwind that lifts light things into the air" },
    ] },
    thorn: { name: "Thorn", color: "#4fb46d", glow: "#c4f7a1", deep: "#08260f", virtue: "growth and patience", effect: "leaves", spells: [
      { name: "Germina Viret", say: "JER-mi-na VEE-ret", sigil: "diamond", does: "coaxes a seed to sprout and a wilted plant back to green" },
      { name: "Radix Tenax", say: "RA-dix TEN-ax", sigil: "infinity", does: "roots and vines that hold a door, or a foe, fast" },
    ] },
    gloam: { name: "Gloam", color: "#a07bff", glow: "#dccbff", deep: "#150a2e", virtue: "secrets and stealth", effect: "smoke", spells: [
      { name: "Umbra Velat", say: "OOM-bra VAY-lat", sigil: "crescent", does: "a veil of shadow that hides you from sight" },
      { name: "Tacitus Gradus", say: "TA-ki-tus GRA-dus", sigil: "square", does: "silences every step you take" },
    ] },
    lumen: { name: "Lumen", color: "#d5deec", glow: "#ffffff", deep: "#161c26", virtue: "light and truth", effect: "rays", spells: [
      { name: "Lux Clara", say: "LUKS KLAH-ra", sigil: "star", does: "a clear white light that shows what was hidden" },
      { name: "Veritas Fulget", say: "VER-i-tas FOOL-get", sigil: "lens", does: "makes a lie flicker in the air like a guttering candle" },
    ] },
  };
  const RANKS = ["Novice", "Apprentice", "Adept", "Spellwright", "Magister"];

  const words = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // What the host may call a school: its name, or what it stands for.
  const SCHOOL_WORDS = {
    ember: ["ember", "fire", "flame", "crimson"], tide: ["tide", "water", "sea", "ocean"], gale: ["gale", "air", "wind", "storm"],
    thorn: ["thorn", "earth", "growth", "nature", "plant"], gloam: ["gloam", "shadow", "dark", "night"], lumen: ["lumen", "light", "truth"],
  };
  function schoolOf(text) {
    const w = ` ${words(text)} `;
    for (const [key, names] of Object.entries(SCHOOL_WORDS)) if (names.some((n) => w.includes(` ${n}`))) return key;
    return null;
  }
  function rankOf(text) {
    const w = words(text);
    return RANKS.find((r) => w.split(" ").includes(r.toLowerCase())) || null;
  }

  // Speech recognisers spell invented words many ways ("Ignis Vela", "ignis
  // bella", "egnis vella"), so the words are compared by how they sound: one
  // letter per sound, doubled letters folded.
  function sound(text) {
    return words(text).replace(/[^a-z]/g, "")
      .replace(/ph/g, "f").replace(/qu/g, "kw").replace(/x/g, "ks").replace(/c/g, "k").replace(/y/g, "i")
      .replace(/[vw]/g, "b").replace(/z/g, "s").replace(/ae/g, "e").replace(/oo|ou/g, "u").replace(/ee/g, "i")
      .replace(/(.)\1+/g, "$1");
  }
  // 1 minus the fewest edits that turn the incantation into some stretch of
  // what was heard, over the incantation's length: the words may sit anywhere
  // in a longer sentence ("okay... ignis vela!").
  function similarity(heard, incantation) {
    const h = sound(heard), t = sound(incantation);
    if (!t) return 0;
    if (!h) return 0;
    let prev = new Array(h.length + 1).fill(0); // a match may start anywhere in h
    for (let i = 1; i <= t.length; i++) {
      const row = [i];
      for (let j = 1; j <= h.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (t[i - 1] === h[j - 1] ? 0 : 1));
      prev = row;
    }
    return Math.max(0, 1 - Math.min(...prev) / t.length); // ... and end anywhere
  }

  function spellIndex(key, ref) {
    const school = SCHOOLS[key];
    if (!school) return -1;
    const s = String(ref == null ? "" : ref).trim();
    if (/^[12]$/.test(s)) return Number(s) - 1;
    // "the second one" names the second.
    if (/\b(second|two)\b/i.test(s)) return 1;
    if (/\b(first|one)\b/i.test(s)) return 0;
    // The name inside the reference ("Ignis Vela, the flame"), or a part of
    // the name long enough to tell ("Vela").
    let best = -1, bestSim = 0;
    school.spells.forEach((spell, i) => {
      const sim = Math.max(similarity(s, spell.name), sound(s).length >= 4 ? similarity(spell.name, s) : 0);
      if (sim > bestSim) { bestSim = sim; best = i; }
    });
    return bestSim >= 0.6 ? best : -1;
  }

  // ---- Judging a traced sigil ------------------------------------------------
  const length = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
  // n points spaced evenly along the path.
  function resample(points, n) {
    if (!points || points.length < 2) return [];
    const L = length(points);
    if (!L) return [];
    const step = L / (n - 1), out = [[points[0][0], points[0][1]]];
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      let [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      let d = Math.hypot(x1 - x0, y1 - y0);
      while (d > 0 && acc + d >= step && out.length < n) {
        const t = (step - acc) / d;
        x0 += t * (x1 - x0); y0 += t * (y1 - y0);
        out.push([x0, y0]);
        d = Math.hypot(x1 - x0, y1 - y0); acc = 0;
      }
      acc += d;
    }
    while (out.length < n) out.push(points[points.length - 1].slice(0, 2));
    return out;
  }
  const nearest = (p, set) => { let m = Infinity; for (const q of set) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < m) m = d; } return m; };
  const templates = new Map(); // kind -> { coarse, dense }
  function template(kind) {
    if (!templates.has(kind)) { const p = SIGILS[kind].path(); templates.set(kind, { coarse: resample(p, 64), dense: resample(p, 256) }); }
    return templates.get(kind);
  }
  // The stroke traced over the sigil's guide, in the same unit square. Two
  // ways to miss count alike: ink far from the sigil, and parts of the sigil
  // the ink never came near. Direction and starting point do not matter.
  function scoreTrace(stroke, kind) {
    if (!SIGILS[kind] || !stroke || stroke.length < 2 || length(stroke) < 0.25) return 0;
    const t = template(kind), ink = resample(stroke, 64), inkDense = resample(stroke, 256);
    const stray = ink.reduce((s, p) => s + nearest(p, t.dense), 0) / ink.length;
    const missed = t.coarse.reduce((s, p) => s + nearest(p, inkDense), 0) / t.coarse.length;
    const d = (stray + missed) / 2;
    return Math.round(100 * Math.min(1, Math.max(0, 1 - (d - 0.012) / 0.09)));
  }

  // Words unspoken halve the power: a sigil alone is half a spell.
  const castPower = (accuracy, spoken) => Math.round(Math.max(0, Math.min(100, accuracy)) * (spoken ? 1 : 0.5));
  const tier = (power) => (power >= 80 ? "brilliant" : power >= 60 ? "solid" : power >= 35 ? "shaky" : "fizzled");

  globalThis.Spellbook = { SCHOOLS, SIGILS, RANKS, schoolOf, spellIndex, rankOf, sound, similarity, length, resample, scoreTrace, castPower, tier };
})();
