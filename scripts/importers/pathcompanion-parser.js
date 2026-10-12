import { norm } from "../common.js";

/**
 * Pure parsing logic: turns a Path Companion character export (JSON) into an
 * import plan. Contains no Foundry API calls, so it can be tested in Node.
 */

export const SKILL_KEYS = {
  "acrobatics": "acr",
  "appraise": "apr",
  "artistry": "art",
  "bluff": "blf",
  "climb": "clm",
  "craft": "crf",
  "diplomacy": "dip",
  "disable device": "dev",
  "disguise": "dis",
  "escape artist": "esc",
  "fly": "fly",
  "handle animal": "han",
  "heal": "hea",
  "intimidate": "int",
  "knowledge (arcana)": "kar",
  "knowledge (dungeoneering)": "kdu",
  "knowledge (engineering)": "ken",
  "knowledge (geography)": "kge",
  "knowledge (history)": "khi",
  "knowledge (local)": "klo",
  "knowledge (nature)": "kna",
  "knowledge (nobility)": "kno",
  "knowledge (planes)": "kpl",
  "knowledge (religion)": "kre",
  "linguistics": "lin",
  "lore": "lor",
  "perception": "per",
  "perform": "prf",
  "profession": "pro",
  "ride": "rid",
  "sense motive": "sen",
  "sleight of hand": "slt",
  "spellcraft": "spl",
  "stealth": "ste",
  "survival": "sur",
  "swim": "swm",
  "use magic device": "umd",
};

export const ALIGNMENTS = {
  "lawful good": "lg",
  "neutral good": "ng",
  "chaotic good": "cg",
  "lawful neutral": "ln",
  "neutral": "tn",
  "true neutral": "tn",
  "chaotic neutral": "cn",
  "lawful evil": "le",
  "neutral evil": "ne",
  "chaotic evil": "ce",
};

/** Caster progression per class (PF1 "casterType": high = 9th, med = 6th, low = 4th level spells). */
export const CASTER_TYPES = {
  wizard: "high", sorcerer: "high", cleric: "high", druid: "high", oracle: "high",
  witch: "high", shaman: "high", psychic: "high", arcanist: "high",
  bard: "med", magus: "med", alchemist: "med", inquisitor: "med", summoner: "med",
  "summoner (unchained)": "med", skald: "med", hunter: "med", investigator: "med",
  warpriest: "med", mesmerist: "med", occultist: "med", spiritualist: "med", medium: "low",
  paladin: "low", antipaladin: "low", ranger: "low", bloodrager: "low",
};

/** Class features that are pure bookkeeping in Path Companion; skipped when not found in a compendium. */
const OPTIONAL_FEATURE_PATTERNS = [
  /^spellcasting\b/i,
  /^spells\b/i,
  /^cantrips$/i,
  /^orisons$/i,
  /^spellbooks?\b/i,
  /^knacks$/i,
  /^weapon and armor proficiency$/i,
];

export function isOptionalFeature(name) {
  return OPTIONAL_FEATURE_PATTERNS.some((re) => re.test(String(name ?? "").trim()));
}

function titleCase(s) {
  return String(s ?? "").replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function spellName(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.name ?? null;
}

/**
 * Builds the import plan.
 * @param {object} pc  Parsed Path Companion JSON
 */
export function buildPlan(pc) {
  if (!pc || typeof pc !== "object" || !pc.characterInfo) {
    throw new Error("Das ist keine Path-Companion-Charakterdatei (Feld 'characterInfo' fehlt).");
  }
  const info = pc.characterInfo;
  const notes = [];

  const plan = {
    name: info.characterName || "Path Companion Import",
    alignment: ALIGNMENTS[norm(info.alignment)] ?? null,
    alignmentLabel: info.alignment ?? "",
    deity: info.deity?.name ?? "",
    age: info.baseAge ?? "",
    abilities: {},
    race: null,
    classes: [],
    feats: [],
    traits: [],
    languages: [],
    skills: {},
    subSkills: [],
    spellbooks: [],
    weapons: [],
    armor: [],
    gear: [],
    currency: { pp: 0, gp: 0, sp: 0, cp: 0 },
    hpCurrent: pc.defense?.hp?.current ?? null,
    notes,
  };

  // --- Abilities ---------------------------------------------------------
  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    const a = pc.abilities?.[key];
    if (!a) continue;
    const bonuses = Array.isArray(a.bonuses) ? a.bonuses : [];
    const sumOf = (type) => bonuses
      .filter((b) => String(b?.type ?? "").toLowerCase() === type && !b?.temporary)
      .reduce((s, b) => s + num(b.value), 0);
    const permanent = num(a.permanentTotal ?? a.total ?? a.inherent, 10);
    plan.abilities[key] = {
      permanent,
      racial: sumOf("racial"),
      enhancement: sumOf("enhancement"),
      inherent: num(a.inherent, permanent),
    };
  }

  // --- Race --------------------------------------------------------------
  if (info.race) {
    plan.race = {
      name: info.race.name || info.race.race,
      traits: (info.race.abilities ?? [])
        .filter((r) => r?.name)
        .map((r) => ({ name: r.name, alternate: r.type === "alternate" })),
    };
  }

  // --- Levels: classes, archetypes, class features, feats -----------------
  const levelInfo = info.levelInfo ?? {};
  const levelKeys = Object.keys(levelInfo)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));

  const classMap = new Map();
  const seenFeats = new Set();
  for (const lk of levelKeys) {
    const lv = levelInfo[lk];
    if (!lv?.class) continue;
    let cls = classMap.get(lv.class);
    if (!cls) {
      cls = {
        name: lv.class,
        level: 0,
        hp: 0,
        fc: { hp: 0, skill: 0, alt: 0 },
        archetypes: [],
        features: [],
      };
      classMap.set(lv.class, cls);
      plan.classes.push(cls);
    }
    cls.level += 1;
    cls.hp += num(lv.hp);
    const fcb = String(lv.favoredClassBonus ?? "").toLowerCase();
    if (fcb === "hp") cls.fc.hp += 1;
    else if (fcb === "skill") cls.fc.skill += 1;
    else if (fcb) cls.fc.alt += 1;

    for (const a of lv.archetypes ?? []) {
      if (a && !cls.archetypes.includes(a)) cls.archetypes.push(a);
    }

    const equivalents = new Map();
    for (const eq of lv.classFeatureEquivalents ?? []) {
      if (eq?.name) equivalents.set(norm(eq.name), eq.source);
    }

    for (const f of lv["Class Features"] ?? []) {
      if (!f?.name) continue;
      cls.features.push({
        name: f.name,
        level: Number(lk),
        variant: f.fnName ?? equivalents.get(norm(f.name)) ?? null,
        type: f.type ?? "",
      });
    }

    for (const ft of lv.Feats ?? []) {
      if (!ft?.name) continue;
      // Proficiencies granted by the class itself are set on the PF1 class item.
      if (String(ft.source ?? "").toLowerCase() === "class") continue;
      const key = norm(ft.name);
      if (seenFeats.has(key)) continue;
      seenFeats.add(key);
      plan.feats.push({ name: ft.name, level: Number(lk), source: ft.source ?? "" });
    }
  }
  if (!plan.classes.length) notes.push("Keine Klassenstufen in der Datei gefunden.");

  // --- Traits & languages ---------------------------------------------------
  for (const t of info.traits ?? []) {
    if (t?.name) plan.traits.push({ name: t.name, type: String(t.type ?? "").toLowerCase() });
  }
  plan.languages = [...new Set([...(info.languages ?? []), ...(info.race?.languages ?? [])])];

  // --- Skills ----------------------------------------------------------------
  const subCounters = {};
  for (const [label, s] of Object.entries(pc.skills ?? {})) {
    const ranks = num(s?.ranks);
    if (s?.baseName) {
      const parent = SKILL_KEYS[norm(s.baseName)];
      if (!parent || ranks <= 0) continue;
      subCounters[parent] = (subCounters[parent] ?? 0) + 1;
      const subName = s.name ?? s.subName ?? s.type ?? s.specialty ?? `${s.baseName} (bitte benennen)`;
      plan.subSkills.push({
        parent,
        key: `${parent}${subCounters[parent]}`,
        name: subName,
        ability: s.ability ?? s.defaultAbility ?? "int",
        rank: ranks,
        cs: !!s.classSkill,
      });
      if (!s.name && !s.subName && !s.type && !s.specialty) {
        notes.push(`${s.baseName}: Spezialisierung fehlt in der Datei, bitte im Bogen benennen.`);
      }
      continue;
    }
    const key = SKILL_KEYS[label.toLowerCase()] ?? SKILL_KEYS[norm(label)];
    if (!key) {
      if (ranks > 0) notes.push(`Fertigkeit „${label}“ (${ranks} Ränge) nicht zugeordnet.`);
      continue;
    }
    if (ranks > 0) plan.skills[key] = ranks;
  }

  // --- Spells ----------------------------------------------------------------
  for (const [className, book] of Object.entries(pc.spells ?? {})) {
    if (!book || typeof book !== "object") continue;
    const byLevel = new Map(); // level -> Map(normName -> {name, prepared})
    const addSpell = (lvl, entry, prepared) => {
      const name = spellName(entry);
      if (!name) return;
      if (!byLevel.has(lvl)) byLevel.set(lvl, new Map());
      const m = byLevel.get(lvl);
      const k = norm(name);
      const cur = m.get(k) ?? { name: /[A-Z]/.test(name) ? name : titleCase(name), level: lvl, prepared: 0 };
      if (/[A-Z]/.test(name)) cur.name = name;
      if (prepared) cur.prepared += 1;
      m.set(k, cur);
    };
    for (const [lvl, list] of Object.entries(book.knownSpells ?? {})) {
      for (const e of list ?? []) addSpell(Number(lvl), e, false);
    }
    for (const [lvl, list] of Object.entries(book.preparedSpells ?? {})) {
      for (const e of list ?? []) addSpell(Number(lvl), e, true);
    }
    const mode = String(book.castingType ?? "").toLowerCase();
    plan.spellbooks.push({
      className: book.className ?? className,
      kind: String(book.spellType ?? "arcane").toLowerCase(),
      ability: book.ability ?? "int",
      mode: ["prepared", "spontaneous", "hybrid"].includes(mode) ? mode : "prepared",
      casterType: CASTER_TYPES[norm(book.className ?? className)] ?? "high",
      spells: [...byLevel.values()].flatMap((m) => [...m.values()]),
    });
  }

  // --- Equipment ---------------------------------------------------------------
  const eq = pc.equipment ?? {};
  for (const w of eq.weapons ?? []) {
    if (!w?.name) continue;
    plan.weapons.push({
      name: w.name,
      quantity: num(w.count ?? w.quantity, 1) || 1,
      equipped: w.equipped !== false,
      masterwork: !!w.masterwork,
      enhancement: num(w.enhancement ?? w.enhancementBonus),
      proficiency: w.proficiency ?? "",
      handedness: w.handedness ?? w.type ?? "",
      damage: w.damage ?? "",
      critical: w.critical ?? "",
      hasEnchantments: Array.isArray(w.enchantments) && w.enchantments.length > 0,
    });
  }
  for (const a of eq.armor ?? []) {
    if (!a?.name) continue;
    plan.armor.push({
      name: a.name,
      equipped: a.equipped === true || a.equipped === "equipped",
      type: String(a.type ?? "").toLowerCase(),
      ac: num(a.ACBonus),
      maxDex: a.maxDexBonus === undefined || a.maxDexBonus === "" ? null : num(a.maxDexBonus),
      acp: Math.abs(num(a.ACPenalty)),
      spellFailure: num(String(a.arcaneSpellFailure ?? "0").replace("%", "")),
      enhancement: num(a.enhancement ?? a.enhancementBonus),
      masterwork: !!a.masterwork,
    });
  }
  const pushGear = (g) => {
    const name = g?.value ?? g?.name;
    if (!name || typeof name !== "string") return;
    plan.gear.push({
      name,
      quantity: num(g.count ?? g.quantity, 1) || 1,
      equipped: g.equipped === true || g.equipped === "equipped",
      category: g.category ?? "",
    });
  };
  for (const g of eq.gear ?? []) pushGear(g);
  // Any further lists (magic items, wondrous items, …) are imported as gear.
  for (const [key, list] of Object.entries(eq)) {
    if (["containers", "weapons", "armor", "gear"].includes(key)) continue;
    if (Array.isArray(list)) list.forEach(pushGear);
  }

  plan.currency = {
    pp: num(eq.platinum),
    gp: num(eq.gold),
    sp: num(eq.silver),
    cp: num(eq.copper),
  };

  if ((eq.containers ?? []).some((c) => c?.index !== "Storage")) {
    notes.push("Behälter (z. B. Rucksack) werden nicht nachgebaut, alle Gegenstände liegen direkt im Inventar.");
  }

  return plan;
}
