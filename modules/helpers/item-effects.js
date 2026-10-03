/**
 * One computation for everything an item's modifiers do.
 *
 * A carrier (weapon, ship weapon, armour, gear, ship attachment) collects modifiers from four
 * places: its own attributes, its qualities, each attachment's base mods, and each attachment's
 * installed modifications. `computeItemEffects` walks those once and reports
 *  - the item's own adjusted stats (damage, soak, encumbrance, hard points, ...),
 *  - the Active Effect changes the item applies to its actor,
 *  - the dice it adds to a roll made with it.
 * Every value is multiplied by its source's rank and an uninstalled modification contributes
 * nothing, so nothing downstream has to know about ranks or installed flags. Whether the item is
 * carried and equipped is decided when the changes are applied (`carrierIsActive`), so the
 * effects always describe what the item would grant.
 *
 * `syncManagedEffects` keeps two Active Effects on each carrier in step with that computation:
 * "(inherent)" for what the item itself grants and "(mods)" for what its modifiers grant. They
 * never have their `disabled` flag written here - edit mode suspends and restores it.
 */
import ModifierHelpers from "./modifiers.js";
import {
  activeEffectChangesUpdate,
  activeEffectCreateData,
  getActiveEffectChanges,
} from "../compatibility/active-effects.js";

export const CARRIER_TYPES = ["weapon", "shipweapon", "armour", "gear", "shipattachment"];
/** Types that can put a weapon in their owner's hands (`system.grantedWeapons`). */
export const GRANT_HOST_TYPES = ["weapon", "armour", "gear", "species"];
export const INHERENT_EFFECT = "(inherent)";
export const MODS_EFFECT = "(mods)";
/** `flags.starwarsffg_sandbox.<MANAGED_FLAG>` names which managed effect an Active Effect is. */
export const MANAGED_FLAG = "managed";

/** Types that only grant what they carry while equipped. Gear is carried as soon as it is owned. */
export const EQUIP_GATED = ["weapon", "armour", "shipweapon"];

/**
 * Whether a carrier's effects reach its actor right now: it is carried (not stowed) and, for
 * equipment that has to be worn or wielded, equipped. Other item types always apply.
 */
export function carrierIsActive(item) {
  if (!item || !CARRIER_TYPES.includes(item.type)) return true;
  const system = item.system ?? {};
  if (system.stowed) return false;
  if (EQUIP_GATED.includes(item.type) && !system.equippable?.equipped) return false;
  return true;
}

/** Modifier types that change a roll, and the dice pool field each modifier lands in. */
const DICE = {
  "Roll Modifiers": { "Add Boost": "boost", "Add Setback": "setback", "Remove Setback": "remsetback" },
  "Result Modifiers": {
    "Add Advantage": "advantage", "Add Dark": "dark", "Add Failure": "failure", "Add Light": "light",
    "Add Success": "success", "Add Threat": "threat", "Add Triumph": "triumph", "Add Despair": "despair",
  },
  "Dice Modifiers": {
    "Add Difficulty": "difficulty", "Upgrade Difficulty": "upgradeDifficulty",
    "Downgrade Difficulty": "downgradeDifficulty", "Upgrade Ability": "upgradeAbility",
    "Downgrade Ability": "downgradeAbility",
  },
};
export const DICE_FIELDS = Object.values(DICE).flatMap((m) => Object.values(m));

/** The stats each carrier type computes an adjusted value for. */
const ITEM_STATS = {
  weapon: ["damage", "crit", "range", "skill", "encumbrance", "price", "rarity", "hardpoints"],
  shipweapon: ["damage", "crit", "range", "skill", "encumbrance", "price", "rarity", "hardpoints"],
  armour: ["soak", "defence", "encumbrance", "price", "rarity", "hardpoints"],
  gear: ["encumbrance", "price", "rarity"],
  shipattachment: ["encumbrance", "price", "rarity", "hardpoints"],
};

/** "Weapon Stat" modifiers, by lower-cased mod. A `-set` mod replaces the base value instead of adding. */
const WEAPON_STAT_MODS = {
  damage: "damage", critical: "crit", range: "range", encumbrance: "encumbrance", price: "price",
  rarity: "rarity", hardpoints: "hardpoints", "damage-set": "damage:set", "critical-set": "crit:set",
  // a range cap ("no longer than Medium") and a change of skill (a pistol grip: Ranged: Light)
  "range-set": "range:set", "skill-set": "skill:set",
};
/** "Armor Stat" modifiers, by lower-cased mod. */
const ARMOR_STAT_MODS = {
  soak: "soak", defence: "defence", defense: "defence", encumbrance: "encumbrance", price: "price",
  rarity: "rarity", hardpoints: "hardpoints", "soak-set": "soak:set", "defence-set": "defence:set",
  "defense-set": "defence:set",
};

const toInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
};

const clone = (value) => {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

/** A modifier's rank. Unset and zero both mean "once". */
export function rankOf(modifier) {
  const rank = parseInt(modifier?.system?.rank, 10);
  return Number.isFinite(rank) && rank > 0 ? rank : 1;
}

/**
 * Which of the item's own stats a modifier adjusts, or null when it is not an item stat.
 * @returns {string|null} "<stat>" or "<stat>:set"
 */
function itemStatTarget(type, modtype, mod) {
  const m = String(mod ?? "").toLowerCase();
  let target = null;
  if (modtype === "Weapon Stat" && (type === "weapon" || type === "shipweapon")) target = WEAPON_STAT_MODS[m] ?? null;
  else if (modtype === "Armor Stat" && type === "armour") target = ARMOR_STAT_MODS[m] ?? null;
  else if (modtype === "Stat") {
    // "Stat / Soak" on armour has always meant the armour's own soak, and encumbrance is a property
    // of the item wherever it is written
    if (m === "encumbrance") target = "encumbrance";
    else if (m === "soak" && type === "armour") target = "soak";
  } else if ((modtype === "Weapon Stat" || modtype === "Armor Stat") && ["encumbrance", "price", "rarity", "hardpoints"].includes(m)) {
    // an attachment typed "all" can land on any carrier
    target = m;
  }
  if (!target) return null;
  return ITEM_STATS[type]?.includes(target.split(":")[0]) ? target : null;
}

/** Remember what a source contributed, so the gear list can show where a value came from. */
function record(stat, name, amount, prefix = "") {
  if (!amount && prefix !== "=") return;
  const value = prefix === "=" ? `=${amount}` : amount > 0 ? `+${amount}` : `${amount}`;
  stat.sources.push({ name, value });
}

/**
 * Every place a carrier's modifiers come from, in the order they apply.
 * @returns {{name: string, attributes: object, rank: number, enabled: boolean, kind: string}[]}
 */
export function enumerateSources(item) {
  const sys = item?.system ?? {};
  const sources = [{ name: item?.name, attributes: sys.attributes, rank: 1, enabled: true, kind: "self" }];
  for (const quality of sys.itemmodifier ?? []) {
    // a mod aimed at a granted weapon changes that weapon, not this item
    if (!quality || weaponIndexOf(quality) !== null) continue;
    sources.push({ name: quality.name, attributes: quality.system?.attributes, rank: rankOf(quality), enabled: true, kind: "quality", ref: quality });
  }
  for (const attachment of sys.itemattachment ?? []) {
    if (!attachment) continue;
    sources.push({ name: attachment.name, attributes: attachment.system?.attributes, rank: 1, enabled: true, kind: "attachment", ref: attachment });
    for (const modification of attachment.system?.itemmodifier ?? []) {
      if (!modification || weaponIndexOf(modification) !== null) continue;
      sources.push({
        name: modification.name, attributes: modification.system?.attributes, rank: rankOf(modification),
        enabled: !!modification.system?.active, kind: "modification", attachment: attachment.name, ref: modification,
      });
    }
  }
  return sources;
}

function zeroDice() {
  return Object.fromEntries(DICE_FIELDS.map((f) => [f, 0]));
}

/**
 * Compute what an item's modifiers do. Pure: `item` may be a document or a plain object.
 * @param {object} item
 * @param {object} [options]
 * @param {object[]} [options.rangeBands] the range ladder (`CONFIG.FFG.ranges` or `vehicle_ranges` values)
 */
export function computeItemEffects(item, { rangeBands = null } = {}) {
  const type = item?.type;
  const sys = item?.system ?? {};
  const stowed = !!sys.stowed;
  const equipped = EQUIP_GATED.includes(type) ? !!sys.equippable?.equipped : true;
  const carried = !stowed;
  const active = carried && equipped;
  const result = {
    type,
    state: { stowed, equipped, carried, active },
    stats: {},
    actorChanges: [],
    inherentChanges: [],
    dice: zeroDice(),
    adjusteditemmodifier: [],
    hardpointsUsed: 0,
    legacyNames: [],
  };
  if (!CARRIER_TYPES.includes(type)) return result;

  for (const key of ITEM_STATS[type]) {
    const stored = sys[key] ?? {};
    if (key === "range") {
      result.stats.range = { base: stored.value ?? "", adjusted: stored.value ?? "", steps: 0, caps: [], sources: [] };
    } else if (key === "skill") {
      result.stats.skill = { base: stored.value ?? "", adjusted: stored.value ?? "", set: null, sources: [] };
    } else {
      const base = toInt(stored.value);
      result.stats[key] = { base, set: null, adds: 0, adjusted: base, sources: [] };
    }
  }

  const actorAdds = new Map();
  const attributeKeys = new Set();
  for (const source of enumerateSources(item)) {
    for (const [attrKey, attr] of Object.entries(source.attributes ?? {})) {
      if (!attr || attrKey.startsWith("-=")) continue;
      attributeKeys.add(attrKey);
      if (!source.enabled) continue;
      const modtype = String(attr.modtype ?? "");
      const mod = String(attr.mod ?? "");
      const raw = Number(attr.value);
      const value = Number.isFinite(raw) ? raw : 0;

      const target = itemStatTarget(type, modtype, mod);
      if (target) {
        const [key, flag] = target.split(":");
        const stat = result.stats[key];
        if (key === "skill") {
          // the weapon is rolled with another skill; the last change wins
          if (flag === "set" && attr.value) {
            stat.set = String(attr.value);
            record(stat, source.name, stat.set, "=");
          }
          continue;
        }
        if (key === "range" && flag === "set") {
          // "no longer than": resolved against the range ladder below
          if (attr.value) {
            stat.caps.push(String(attr.value));
            record(stat, source.name, String(attr.value), "=");
          }
          continue;
        }
        if (flag === "set") {
          stat.set = stat.set === null ? value : Math.max(stat.set, value);
          record(stat, source.name, value, "=");
        } else if (key === "range") {
          const steps = value * source.rank;
          stat.steps += steps;
          record(stat, source.name, steps);
        } else {
          const amount = value * source.rank;
          stat.adds += amount;
          record(stat, source.name, amount);
        }
        continue;
      }
      // an item stat the carrier does not have (a Superior quality's soak on a weapon) is nothing, never an actor change
      if (modtype === "Weapon Stat" || modtype === "Armor Stat") continue;

      const diceField = DICE[modtype]?.[mod];
      if (diceField) {
        result.dice[diceField] += value * source.rank;
        continue;
      }
      // flags rather than amounts, and meaningless on equipment
      if (modtype === "Career Skill" || modtype === "Force Boost") continue;
      for (const exploded of ModifierHelpers.explodeMod(modtype, mod)) {
        const path = ModifierHelpers.getModKeyPath(exploded.modType, exploded.mod);
        if (!path) continue;
        actorAdds.set(path, (actorAdds.get(path) ?? 0) + value * source.rank);
      }
    }
  }
  result.legacyNames = [...attributeKeys];

  for (const [key, stat] of Object.entries(result.stats)) {
    if (key === "range" || key === "skill") continue;
    stat.adjusted = (stat.set ?? stat.base) + stat.adds;
  }
  const skill = result.stats.skill;
  if (skill) skill.adjusted = skill.set ?? skill.base;
  const crit = result.stats.crit;
  if (crit && crit.adjusted < 1 && (crit.base > 0 || crit.set !== null)) crit.adjusted = 1;

  const range = result.stats.range;
  if (range && Array.isArray(rangeBands) && (range.steps || range.caps.length)) {
    const indexOf = (band) => rangeBands.findIndex((r) => r.value === band);
    let index = indexOf(range.base);
    if (index > -1) {
      if (range.steps) index = Math.min(Math.max(index + range.steps, 0), rangeBands.length - 1);
      for (const cap of range.caps) {
        const capIndex = indexOf(cap);
        if (capIndex > -1 && index > capIndex) index = capIndex;
      }
      range.adjusted = rangeBands[index].value;
    }
  }

  if (result.stats.hardpoints) {
    for (const attachment of sys.itemattachment ?? []) {
      // an attachment spends hard points rather than granting them
      const used = toInt(attachment?.system?.hardpoints?.value);
      result.hardpointsUsed += used;
      record(result.stats.hardpoints, attachment?.name, -used);
    }
    result.stats.hardpoints.current = result.stats.hardpoints.adjusted - result.hardpointsUsed;
  }

  // the qualities list the sheets show: the carrier's own, with installed modifications of the
  // same name folding their ranks in
  for (const quality of sys.itemmodifier ?? []) {
    if (!quality) continue;
    const entry = clone(quality);
    entry.system = entry.system ?? {};
    entry.system.rank_current = entry.system.rank ?? null;
    result.adjusteditemmodifier.push(entry);
  }
  for (const attachment of sys.itemattachment ?? []) {
    for (const modification of attachment?.system?.itemmodifier ?? []) {
      if (!modification?.system?.active) continue;
      const found = result.adjusteditemmodifier.find((m) => m.name === modification.name);
      if (found) {
        // each source brings all of its own ranks, not a single one
        if (toInt(found.system.rank)) found.system.rank_current = toInt(found.system.rank_current) + (toInt(modification.system.rank) || 1);
      } else {
        const entry = clone(modification);
        entry.system = entry.system ?? {};
        entry.system.rank_current = toInt(modification.system.rank) || null;
        entry.adjusted = true;
        result.adjusteditemmodifier.push(entry);
      }
    }
  }

  // what the item itself grants its actor
  if (type === "armour") {
    const soak = result.stats.soak.adjusted;
    const defence = result.stats.defence.adjusted;
    if (soak) result.inherentChanges.push({ key: ModifierHelpers.getModKeyPath("Stat", "Soak"), type: "add", value: soak });
    if (defence) {
      result.inherentChanges.push({ key: ModifierHelpers.getModKeyPath("Stat", "Defence.Melee"), type: "add", value: defence });
      result.inherentChanges.push({ key: ModifierHelpers.getModKeyPath("Stat", "Defence.Ranged"), type: "add", value: defence });
    }
  } else if (type === "shipattachment") {
    // hard points are spent, not gained
    const used = toInt(sys.hardpoints?.value);
    if (used) result.inherentChanges.push({ key: ModifierHelpers.getModKeyPath("Vehicle Stat", "Vehicle.Hardpoints"), type: "add", value: -used });
  }

  result.actorChanges = [...actorAdds.entries()]
    .filter(([, value]) => value !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, type: "add", value }));

  return result;
}

/** Whether two change lists would apply the same thing. */
export function sameChanges(a, b) {
  const norm = (changes) => (changes ?? [])
    .map((c) => `${c.key}|${c.type ?? "add"}|${String(c.value)}`)
    .sort()
    .join("\n");
  return norm(a) === norm(b);
}

/** Effect names the old per-attribute pipeline used, which the sync replaces. */
export function isLegacyEffect(effect, legacyNames = []) {
  const name = String(effect?.name ?? "");
  if (name === INHERENT_EFFECT || name === MODS_EFFECT) return false;
  if (effect?.flags?.starwarsffg_sandbox?.[MANAGED_FLAG]) return false;
  return /^attr\d+$/.test(name) || legacyNames.includes(name) || name === "Superior";
}

/**
 * Bring a carrier's managed Active Effects in line with its modifiers. Idempotent, and joins a
 * sync already running for the same item.
 * @param {Item} item
 * @param {object} [options]
 * @param {boolean} [options.force] run even while the owning actor is in edit mode
 */
export async function syncManagedEffects(item, { force = false } = {}) {
  if (!item || !CARRIER_TYPES.includes(item.type)) return;
  if (item._ffgSyncing) return item._ffgSyncing;
  const run = (async () => {
    const pack = item.pack ? game.packs?.get(item.pack) : null;
    if (pack?.locked) return;
    const editing = !!item.actor?.getFlag?.("starwarsffg_sandbox", "config.enableEditMode");
    if (editing && !force) {
      // edit mode has suspended every effect in memory; a write now would race its restore
      CONFIG.logger?.debug?.(`Skipping managed effect sync for ${item.name}: actor is in edit mode`);
      return;
    }
    const computed = computeItemEffects(item);
    const effects = item.effects?.contents ?? [];
    const managed = (name) =>
      effects.find((e) => e.flags?.starwarsffg_sandbox?.[MANAGED_FLAG] === name) ?? effects.find((e) => e.name === name);

    const toCreate = [];
    const toUpdate = [];
    const toDelete = [];
    const wanted = [
      [INHERENT_EFFECT, computed.inherentChanges, true],
      [MODS_EFFECT, computed.actorChanges, false],
    ];
    for (const [name, changes, always] of wanted) {
      const existing = managed(name);
      if (!existing) {
        if (!always && !changes.length) continue;
        toCreate.push(activeEffectCreateData({
          name,
          img: item.img,
          transfer: true,
          disabled: false,
          flags: { starwarsffg_sandbox: { [MANAGED_FLAG]: name } },
          changes,
        }));
        continue;
      }
      const update = { _id: existing.id };
      if (!sameChanges(getActiveEffectChanges(existing), changes)) Object.assign(update, activeEffectChangesUpdate(changes));
      if (existing.flags?.starwarsffg_sandbox?.[MANAGED_FLAG] !== name) update[`flags.starwarsffg_sandbox.${MANAGED_FLAG}`] = name;
      // a managed effect carries its gating in its change list, so a disabled one is stale data
      // (an import, or a copy made before this version) - unless edit mode suspended it
      if (existing.disabled && !editing) update.disabled = false;
      if (Object.keys(update).length > 1) toUpdate.push(update);
    }
    for (const effect of effects) {
      if (isLegacyEffect(effect, computed.legacyNames)) toDelete.push(effect.id);
    }
    // a second copy of a managed effect (two syncs that could not see each other) would count twice
    for (const name of [INHERENT_EFFECT, MODS_EFFECT]) {
      const copies = effects.filter((e) => (e.flags?.starwarsffg_sandbox?.[MANAGED_FLAG] ?? e.name) === name);
      for (const extra of copies.slice(1)) if (!toDelete.includes(extra.id)) toDelete.push(extra.id);
    }

    if (toDelete.length) await item.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    if (toUpdate.length) await item.updateEmbeddedDocuments("ActiveEffect", toUpdate);
    if (toCreate.length) await item.createEmbeddedDocuments("ActiveEffect", toCreate);
  })();
  item._ffgSyncing = run.finally(() => {
    delete item._ffgSyncing;
  });
  return item._ffgSyncing;
}

/**
 * Strip the effects the old pipeline put on a carrier from creation data, and make sure its
 * managed effects arrive enabled. Used by `ItemFFG._preCreate`; the sync fills the values in.
 * @param {object[]} effects source effect data
 * @returns {object[]|null} the cleaned list, or null when nothing needed changing
 */
export function normalizeCarrierEffects(effects) {
  if (!Array.isArray(effects) || !effects.length) return null;
  let changed = false;
  const kept = [];
  for (const effect of effects) {
    if (isLegacyEffect(effect)) {
      changed = true;
      continue;
    }
    const name = effect?.name;
    const isManaged = name === INHERENT_EFFECT || name === MODS_EFFECT || effect?.flags?.starwarsffg_sandbox?.[MANAGED_FLAG];
    if (isManaged && effect.disabled) {
      changed = true;
      kept.push({ ...effect, disabled: false });
    } else {
      kept.push(effect);
    }
  }
  return changed ? kept : null;
}

/**
 * The talents an item's installed modifications grant, keyed by the talent's import key.
 */
export function grantedTalents(item) {
  const grants = new Map();
  if (!carrierIsActive(item)) return grants;
  for (const source of enumerateSources(item)) {
    const grant = source.ref?.system?.grants;
    if (!source.enabled || grant?.type !== "talent") continue;
    const key = grant.key ?? grant.name;
    if (key && !grants.has(key)) grants.set(key, grant);
  }
  return grants;
}

/**
 * Grant syncs for one item run one after another. An item created and updated in quick
 * succession (an importer creating a weapon, then linking it into a holster) would otherwise
 * run two syncs at once, each seeing nothing granted yet and each granting a copy.
 */
const grantSyncs = new Map();
function serialized(item, kind, work) {
  const key = `${kind}:${item.uuid ?? item.id}`;
  const previous = grantSyncs.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work).finally(() => {
    if (grantSyncs.get(key) === run) grantSyncs.delete(key);
  });
  grantSyncs.set(key, run);
  return run;
}

/**
 * What an item has already granted, keyed by grant key, with any duplicates (from syncs that
 * once raced) set aside for deletion.
 */
function heldGrants(actor, item, type) {
  const held = new Map();
  const extra = [];
  for (const doc of actor.items) {
    const flag = doc.type === type ? doc.getFlag("starwarsffg_sandbox", "grantedBy") : null;
    if (flag?.item !== item.id) continue;
    if (held.has(flag.key)) extra.push(doc.id);
    else held.set(flag.key, doc);
  }
  return { held, extra };
}

/**
 * Give an actor the talents its item's installed modifications grant, and take back the ones
 * they no longer do. Granted talents are flagged with the item that granted them.
 */
export function syncGrantedTalents(item) {
  const actor = item?.actor;
  if (!actor || !CARRIER_TYPES.includes(item.type) || item.pack) return Promise.resolve();
  return serialized(item, "talent", () => syncGrantedTalentsNow(item, actor));
}

async function syncGrantedTalentsNow(item, actor) {
  const wanted = grantedTalents(item);
  const { held, extra } = heldGrants(actor, item, "talent");
  const toDelete = [...extra, ...[...held.entries()].filter(([key]) => !wanted.has(key)).map(([, t]) => t.id)];
  const toCreate = [];
  for (const [key, grant] of wanted) {
    if (held.has(key)) continue;
    let source = null;
    try {
      source = grant.uuid ? await fromUuid(grant.uuid) : null;
      if (!source) source = await findTalent(key, grant.name);
    } catch (error) {
      CONFIG.logger?.warn?.(`${item.name}: looking up the talent "${grant.name ?? key}" failed`, error);
    }
    if (!source || source.type !== "talent") {
      CONFIG.logger?.warn?.(`${item.name}: cannot find the talent "${grant.name ?? key}" its modification grants`);
      continue;
    }
    const data = source.toObject();
    delete data._id;
    data.flags = data.flags ?? {};
    data.flags.starwarsffg_sandbox = { ...(data.flags.starwarsffg_sandbox ?? {}), grantedBy: { item: item.id, key } };
    toCreate.push(data);
  }
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}

/**
 * A talent by its OggDude import key, or failing that its name: world items first, then every
 * Item compendium the world can read.
 */
export async function findTalent(key, name) {
  const matches = (doc) => doc?.type === "talent" && (
    (key && doc.flags?.starwarsffg_sandbox?.ffgimportid === key) || (name && doc.name === name));
  const world = (game.items ?? []).find(matches);
  if (world) return world;
  let byName = null;
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: ["type", "flags.starwarsffg_sandbox.ffgimportid"] });
    for (const entry of index) {
      if (entry.type !== "talent") continue;
      if (key && entry.flags?.starwarsffg_sandbox?.ffgimportid === key) return pack.getDocument(entry._id);
      if (name && entry.name === name && !byName) byName = { pack, id: entry._id };
    }
  }
  return byName ? byName.pack.getDocument(byName.id) : null;
}

/** Which granted weapon a mod belongs to (OggDude WeaponModifierIndex), or null for the item itself. */
export function weaponIndexOf(modifier) {
  const index = modifier?.system?.weaponIndex;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * The weapons an item puts in its owner's hands right now, keyed so a granted weapon can be told
 * apart from the next one: the item's own profiles while it is carried, plus those of each
 * attachment on it. Each entry carries the mods aimed at that profile (an attachment's installed
 * modifications, the item's own qualities).
 * @returns {Map<string, {profile: object, mods: object[]}>}
 */
export function grantedWeapons(item) {
  const grants = new Map();
  if (!item || !GRANT_HOST_TYPES.includes(item.type) || !carrierIsActive(item)) return grants;
  const sys = item.system ?? {};
  (sys.grantedWeapons ?? []).forEach((profile, i) => {
    if (!profile?.name) return;
    const mods = (sys.itemmodifier ?? []).filter((quality) => weaponIndexOf(quality) === i);
    grants.set(`w${i}`, { profile, mods });
  });
  (sys.itemattachment ?? []).forEach((attachment, a) => {
    const id = attachment?._id ?? attachment?.id ?? String(a);
    (attachment?.system?.grantedWeapons ?? []).forEach((profile, i) => {
      if (!profile?.name) return;
      const mods = (attachment.system?.itemmodifier ?? [])
        .filter((modification) => modification?.system?.active && weaponIndexOf(modification) === i);
      grants.set(`a${id}:w${i}`, { profile, mods });
    });
  });
  return grants;
}

/**
 * The weapon item to create for a grant: the stored profile, carried and wielded, with the mods
 * aimed at it as its own qualities, and a flag naming what granted it. The flag carries a
 * signature of everything derived, so a sync can tell when the weapon needs rewriting.
 */
export function grantedWeaponData(host, key, profile, mods = []) {
  const data = structuredClone(profile);
  delete data._id;
  data.type = "weapon";
  data.system = data.system ?? {};
  data.system.grantedWeapons = [];
  data.system.equippable = { ...(data.system.equippable ?? {}), equipped: true };
  data.system.stowed = false;
  data.system.storedIn = "";
  data.system.itemmodifier = [
    ...(data.system.itemmodifier ?? []),
    ...mods.map((mod) => {
      const copy = structuredClone(mod);
      copy.system = { ...(copy.system ?? {}), active: true };
      delete copy.system.weaponIndex;
      return copy;
    }),
  ];
  const sys = data.system;
  const signature = JSON.stringify({
    name: data.name, img: data.img, skill: sys.skill, damage: sys.damage?.value, crit: sys.crit?.value, range: sys.range?.value,
    characteristic: sys.characteristic, attributes: sys.attributes,
    qualities: sys.itemmodifier.map((q) => [q?.name, q?.system?.rank, q?.system?.attributes]),
  });
  data.flags = data.flags ?? {};
  data.flags.starwarsffg_sandbox = { ...(data.flags.starwarsffg_sandbox ?? {}), grantedBy: { item: host.id, key, signature } };
  return data;
}

/**
 * Give an actor the weapons its item grants, rewrite the ones whose profile or mods changed, and
 * take back the ones it no longer grants.
 */
export function syncGrantedWeapons(item) {
  const actor = item?.actor;
  if (!actor || !GRANT_HOST_TYPES.includes(item.type) || item.pack) return Promise.resolve();
  return serialized(item, "weapon", () => syncGrantedWeaponsNow(item, actor));
}

async function syncGrantedWeaponsNow(item, actor) {
  const wanted = grantedWeapons(item);
  const { held, extra } = heldGrants(actor, item, "weapon");
  const toDelete = [...extra, ...[...held.entries()].filter(([key]) => !wanted.has(key)).map(([, w]) => w.id)];
  const toCreate = [];
  const toUpdate = [];
  for (const [key, { profile, mods }] of wanted) {
    const data = grantedWeaponData(item, key, profile, mods);
    const existing = held.get(key);
    if (!existing) toCreate.push(data);
    else if (existing.getFlag("starwarsffg_sandbox", "grantedBy")?.signature !== data.flags.starwarsffg_sandbox.grantedBy.signature) {
      toUpdate.push({ _id: existing.id, name: data.name, img: data.img, system: data.system, flags: data.flags });
    }
  }
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (toUpdate.length) await actor.updateEmbeddedDocuments("Item", toUpdate);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}

/** Take back every weapon an item granted - for when the item itself goes. */
export async function removeGrantedWeapons(actor, itemId) {
  if (!actor) return;
  const ids = actor.items.filter((w) => w.type === "weapon" && w.getFlag("starwarsffg_sandbox", "grantedBy")?.item === itemId).map((w) => w.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}

/** Take back every talent an item granted - for when the item itself goes. */
export async function removeGrantedTalents(actor, itemId) {
  if (!actor) return;
  const ids = actor.items.filter((t) => t.type === "talent" && t.getFlag("starwarsffg_sandbox", "grantedBy")?.item === itemId).map((t) => t.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}
