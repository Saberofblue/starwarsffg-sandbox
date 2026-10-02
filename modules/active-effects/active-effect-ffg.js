import {
  activeEffectChangesUpdate,
  activeEffectCreateData,
} from "../compatibility/active-effects.js";
import { carrierIsActive, INHERENT_EFFECT, MANAGED_FLAG } from "../helpers/item-effects.js";

function disablePushOnItem(options){
  // don't show push/animation if that's an effect from item
  if(options.parent?.parentCollection === "items")
  {
    options.animate = false;
  }
}

/**
 * Whether a change carried by an item should reach the actor right now: weapons and armour only
 * grant what they carry while equipped, and nothing stowed grants anything. The managed effects
 * describe what the item would grant; this is where the equip state is applied, so every client
 * sees the same answer the moment the item changes.
 */
function carrierChangeApplies(effect, change) {
  const item = effect.parent;
  if (!carrierIsActive(item)) return false;
  const stat = change ? ARMOUR_STAT_KEYS[change.key] : null;
  if (stat && item?.type === "armour" && effect.name === INHERENT_EFFECT && effect.flags?.starwarsffg_sandbox?.[MANAGED_FLAG]) {
    return bestArmourFor(item, stat) === item;
  }
  return true;
}

/** The actor stat each line of an armour's own (inherent) effect feeds, by change key. */
const ARMOUR_STAT_KEYS = {
  "system.stats.soak.value": "soak",
  "system.stats.defence.melee": "defence",
  "system.stats.defence.ranged": "defence",
};

/**
 * Armour does not stack: of the armour an actor wears, only the piece with the highest value grants
 * that stat (soak and defence judged separately, ties to the first in the inventory), as OggDude
 * and the rules have it. Mods and talents carried by the other pieces still apply.
 */
function bestArmourFor(item, stat) {
  const actor = item.actor ?? item.parent;
  if (!actor?.items) return item;
  const value = (armour) => parseInt(armour.system?.[stat]?.adjusted ?? armour.system?.[stat]?.value, 10) || 0;
  let best = null;
  for (const armour of actor.items) {
    if (armour.type !== "armour" || !carrierIsActive(armour)) continue;
    if (best === null || value(armour) > value(best)) best = armour;
  }
  return best ?? item;
}

/**
 * Extend the basic ActiveEffect
 * @extends {ActiveEffect}
 */
export class ActiveEffectFFG extends foundry.documents.ActiveEffect {
  /**
   * Normalize all system-created effects before Foundry constructs documents.
   * @override
   */
  static async createDocuments(data = [], context = {}) {
    return super.createDocuments(data.map(effect => activeEffectCreateData(effect)), context);
  }

  /** @override */
  async update(data = {}, operation = {}) {
    if (Array.isArray(data.changes) || Array.isArray(data.system?.changes)) {
      const changes = data.system?.changes ?? data.changes;
      const normalized = activeEffectChangesUpdate(changes);
      data = {...data};
      delete data.changes;
      if (data.system?.changes) {
        data.system = {...data.system};
        delete data.system.changes;
        if (!Object.keys(data.system).length) delete data.system;
      }
      Object.assign(data, normalized);
    }
    return super.update(data, operation);
  }

  /** @override */
  async _onCreate(changed, options, userId) {
    disablePushOnItem(options);
    await super._onCreate(changed, options, userId);
  }

  /** @override */
  async _onUpdate(changed, options, userId) {
    disablePushOnItem(options);
    await super._onUpdate(changed, options, userId);
  }

  /** @override */
  async _onDelete(options, userId) {
    disablePushOnItem(options);
    await super._onDelete(options, userId);
  }

  /**
   * Version 14 asks each effect whether a change applies before applying it.
   * @override
   */
  shouldApplyChange(change, options) {
    if (!carrierChangeApplies(this, change)) return false;
    return super.shouldApplyChange ? super.shouldApplyChange(change, options) : true;
  }

  /**
   * Version 13 applies through the instance; the same gate.
   * @override
   */
  apply(doc, change, ...args) {
    if (!carrierChangeApplies(this, change)) return {};
    return super.apply(doc, change, ...args);
  }
}
