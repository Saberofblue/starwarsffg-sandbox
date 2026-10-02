import { CARRIER_TYPES, syncGrantedTalents, syncManagedEffects } from "../helpers/item-effects.js";

/**
 * Rebuild every carrier's managed Active Effects from its data.
 *
 * Before this version a carrier (weapon, armour, gear, ship weapon, ship attachment) carried one
 * Active Effect per modifier attribute, written by whichever sheet or importer last touched it,
 * with ranks, installed flags and equip state applied inconsistently. Now `(inherent)` and
 * `(mods)` are derived from the item's data by `helpers/item-effects.js`. This walks every
 * carrier the world holds, rebuilds its two managed effects, deletes the per-attribute ones,
 * and grants whatever talents its installed modifications grant.
 *
 * Also exposed as `game.ffg.ItemEffects.rebuildWorld()` for a world whose items were edited by
 * an older version after this ran.
 */
export const ITEM_EFFECTS_MIGRATION_VERSION = 1;

/** The actor values a rebuild can change, compared before and after so the report can say so. */
const WATCHED = [
  "system.stats.soak.value",
  "system.stats.defence.melee",
  "system.stats.defence.ranged",
  "system.stats.wounds.max",
  "system.stats.strain.max",
  "system.stats.encumbrance.max",
  "system.stats.encumbrance.value",
];

function snapshot(actor) {
  return Object.fromEntries(WATCHED.map((path) => [path, foundry.utils.getProperty(actor, path)]));
}

async function migrateCarrier(item, report) {
  if (!CARRIER_TYPES.includes(item?.type)) return;
  try {
    await syncManagedEffects(item, { force: true });
    await syncGrantedTalents(item);
    report.items.push(item.uuid);
  } catch (error) {
    report.failed.push({ uuid: item?.uuid ?? "unknown", reason: error.message });
  }
}

async function migrateActor(actor, report) {
  const before = snapshot(actor);
  for (const item of actor.items.filter((i) => CARRIER_TYPES.includes(i.type))) await migrateCarrier(item, report);
  actor.reset();
  const after = snapshot(actor);
  const diffs = WATCHED.filter((path) => String(before[path]) !== String(after[path]))
    .map((path) => `${path}: ${before[path]} -> ${after[path]}`);
  if (diffs.length) report.changed.push({ actor: actor.name, uuid: actor.uuid, diffs });
}

/**
 * @returns {Promise<{ran: boolean, items: string[], changed: object[], failed: object[], lockedPacks: string[]}>}
 */
export async function migrateItemEffectsV2() {
  const report = { ran: false, items: [], changed: [], failed: [], lockedPacks: [] };
  if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return report;
  report.ran = true;

  for (const actor of game.actors ?? []) await migrateActor(actor, report);
  for (const item of game.items ?? []) await migrateCarrier(item, report);

  const seenSyntheticActors = new Set();
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actorLink || !token.actor || seenSyntheticActors.has(token.actor.uuid)) continue;
      seenSyntheticActors.add(token.actor.uuid);
      await migrateActor(token.actor, report);
    }
  }

  for (const pack of game.packs ?? []) {
    if (!["Actor", "Item"].includes(pack.documentName)) continue;
    if (pack.locked || pack.metadata?.packageType !== "world") {
      report.lockedPacks.push(pack.collection);
      continue;
    }
    try {
      for (const document of await pack.getDocuments()) {
        if (pack.documentName === "Actor") await migrateActor(document, report);
        else await migrateCarrier(document, report);
      }
    } catch (error) {
      report.failed.push({ uuid: `Compendium.${pack.collection}`, reason: error.message });
    }
  }
  return report;
}
