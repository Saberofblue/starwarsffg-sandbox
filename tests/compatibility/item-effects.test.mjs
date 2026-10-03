import assert from "node:assert/strict";
import test from "node:test";

// The modifier helpers pull in a FormApplication subclass at module load.
globalThis.FormApplication ??= class {};
globalThis.CONFIG ??= { logger: { debug() {}, warn() {}, error() {} } };

const { computeItemEffects, sameChanges, normalizeCarrierEffects, isLegacyEffect, carrierIsActive } =
  await import("../../modules/helpers/item-effects.js");

const attr = (modtype, mod, value) => ({ [`attr${Math.random().toString(36).slice(2)}`]: { modtype, mod, value } });

function weapon({ equipped = true, stowed = false, attributes = {}, qualities = [], attachments = [] } = {}) {
  return {
    type: "weapon",
    name: "qa blaster",
    system: {
      damage: { value: 6 }, crit: { value: 3 }, range: { value: "Medium" }, encumbrance: { value: 2 },
      price: { value: 100 }, rarity: { value: 4 }, hardpoints: { value: 3 },
      equippable: { equipped }, stowed, attributes, itemmodifier: qualities, itemattachment: attachments,
    },
  };
}

const modification = (name, attributes, { installed = true, rank = 1 } = {}) =>
  ({ name, type: "itemmodifier", system: { active: installed, rank, attributes } });
const attachment = (name, { attributes = {}, modifications = [], hardpoints = 1 } = {}) =>
  ({ name, type: "itemattachment", system: { hardpoints: { value: hardpoints }, attributes, itemmodifier: modifications } });

test("an installed, ranked modification applies once per rank to item stats, actor changes and dice", () => {
  const item = weapon({
    attachments: [attachment("scope", {
      modifications: [modification("qa mod", {
        ...attr("Weapon Stat", "damage", 1),
        ...attr("Stat", "Soak", 1),
        ...attr("Roll Modifiers", "Add Boost", 1),
      }, { rank: 3 })],
    })],
  });
  const r = computeItemEffects(item);
  assert.equal(r.stats.damage.adjusted, 6 + 3);
  assert.deepEqual(r.actorChanges, [{ key: "system.stats.soak.value", type: "add", value: 3 }]);
  assert.equal(r.dice.boost, 3);
  assert.equal(r.stats.hardpoints.current, 2);
});

test("an uninstalled modification contributes nothing", () => {
  const item = weapon({
    attachments: [attachment("scope", {
      modifications: [modification("qa mod", { ...attr("Weapon Stat", "damage", 2), ...attr("Stat", "Soak", 2) }, { installed: false })],
    })],
  });
  const r = computeItemEffects(item);
  assert.equal(r.stats.damage.adjusted, 6);
  assert.deepEqual(r.actorChanges, []);
  assert.equal(r.adjusteditemmodifier.length, 0);
});

test("an unequipped weapon still describes what it would grant; applying it is gated", () => {
  const item = weapon({ equipped: false, attributes: { ...attr("Weapon Stat", "damage", 1), ...attr("Stat", "Soak", 1) } });
  const r = computeItemEffects(item);
  assert.equal(r.stats.damage.adjusted, 7);
  assert.deepEqual(r.actorChanges, [{ key: "system.stats.soak.value", type: "add", value: 1 }]);
  assert.equal(r.state.active, false);
  assert.equal(carrierIsActive(item), false);
  item.system.equippable.equipped = true;
  assert.equal(carrierIsActive(item), true);
});

test("a stowed item is not active even when equipped, and gear is active as soon as it is owned", () => {
  const stowed = weapon({ stowed: true, attributes: attr("Stat", "Soak", 1) });
  assert.equal(computeItemEffects(stowed).state.carried, false);
  assert.equal(carrierIsActive(stowed), false);
  assert.equal(carrierIsActive({ type: "gear", system: {} }), true);
  assert.equal(carrierIsActive({ type: "shipweapon", system: { equippable: { equipped: false } } }), false);
  assert.equal(carrierIsActive({ type: "talent", system: {} }), true);
});

test("a base-damage set replaces the base before additions, and crit floors at one", () => {
  const item = weapon({
    attachments: [attachment("crystal", {
      attributes: { ...attr("Weapon Stat", "damage-set", 9), ...attr("Weapon Stat", "critical-set", 2) },
      modifications: [
        modification("damage +1", attr("Weapon Stat", "damage", 1), { rank: 2 }),
        modification("crit -1", attr("Weapon Stat", "critical", -1), { rank: 2 }),
      ],
    })],
  });
  const r = computeItemEffects(item);
  assert.equal(r.stats.damage.adjusted, 9 + 2);
  assert.equal(r.stats.crit.adjusted, 1);
});

test("a range step walks the band ladder", () => {
  const bands = [{ value: "Short" }, { value: "Medium" }, { value: "Long" }, { value: "Extreme" }];
  const r = computeItemEffects(weapon({ attributes: attr("Weapon Stat", "range", 1) }), { rangeBands: bands });
  assert.equal(r.stats.range.adjusted, "Long");
});

test("armour grants its adjusted soak and defence through the inherent changes", () => {
  const armour = {
    type: "armour", name: "qa armour",
    system: {
      soak: { value: 2 }, defence: { value: 1 }, encumbrance: { value: 3 }, price: { value: 1 }, rarity: { value: 1 },
      hardpoints: { value: 2 }, equippable: { equipped: true },
      attributes: attr("Stat", "Soak", 1),
      itemmodifier: [], itemattachment: [attachment("insert", { modifications: [modification("qa melee", attr("Stat", "Defence-Melee", 1))] })],
    },
  };
  let r = computeItemEffects(armour);
  assert.equal(r.stats.soak.adjusted, 3, "the armour's own Stat/Soak raises its soak");
  assert.deepEqual(r.inherentChanges.map((c) => [c.key, c.value]), [
    ["system.stats.soak.value", 3], ["system.stats.defence.melee", 1], ["system.stats.defence.ranged", 1],
  ]);
  assert.deepEqual(r.actorChanges, [{ key: "system.stats.defence.melee", type: "add", value: 1 }]);
  armour.system.equippable.equipped = false;
  r = computeItemEffects(armour);
  assert.equal(r.inherentChanges.length, 3, "the description does not change; applying it does");
  assert.equal(carrierIsActive(armour), false);
});

test("gear carries an encumbrance threshold bonus per rank and its own encumbrance", () => {
  const backpack = {
    type: "gear", name: "Backpack",
    system: {
      encumbrance: { value: 2 }, price: { value: 1 }, rarity: { value: 1 }, quantity: { value: 1 },
      attributes: {}, itemattachment: [],
      itemmodifier: [{ name: "Increases Encumbrance Threshold Mod", system: { rank: 4, attributes: attr("Stat", "EncumbranceMax", 1) } }],
    },
  };
  const r = computeItemEffects(backpack);
  assert.deepEqual(r.actorChanges, [{ key: "system.stats.encumbrance.max", type: "add", value: 4 }]);
  assert.equal(r.stats.encumbrance.adjusted, 2);
  backpack.system.stowed = true;
  assert.equal(carrierIsActive(backpack), false);
});

test("a ship attachment spends the vehicle's hard points", () => {
  const r = computeItemEffects({ type: "shipattachment", name: "qa", system: { hardpoints: { value: 2 }, encumbrance: { value: 0 }, price: { value: 0 }, rarity: { value: 0 } } });
  assert.deepEqual(r.inherentChanges, [{ key: "system.stats.customizationHardPoints.value", type: "add", value: -2 }]);
});

test("qualities fold installed modifications of the same name into one rank total", () => {
  const item = weapon({
    qualities: [{ name: "Accurate", system: { rank: 1, attributes: attr("Roll Modifiers", "Add Boost", 1) } }],
    attachments: [attachment("grip", { modifications: [modification("Accurate", attr("Roll Modifiers", "Add Boost", 1), { rank: 2 })] })],
  });
  const r = computeItemEffects(item);
  assert.equal(r.adjusteditemmodifier.length, 1);
  assert.equal(r.adjusteditemmodifier[0].system.rank_current, 3);
  assert.equal(r.dice.boost, 3);
});

test("change lists compare by content and legacy effects are recognised", () => {
  assert.ok(sameChanges([{ key: "a", type: "add", value: 1 }], [{ key: "a", value: "1" }]));
  assert.ok(!sameChanges([{ key: "a", type: "add", value: 1 }], []));
  assert.ok(isLegacyEffect({ name: "attr1700000000000" }));
  assert.ok(isLegacyEffect({ name: "Superior" }));
  assert.ok(!isLegacyEffect({ name: "(inherent)" }));
  assert.ok(!isLegacyEffect({ name: "Custom", flags: {} }));
  const cleaned = normalizeCarrierEffects([
    { name: "attr1" }, { name: "(inherent)", disabled: true }, { name: "Custom", disabled: true },
  ]);
  assert.deepEqual(cleaned, [{ name: "(inherent)", disabled: false }, { name: "Custom", disabled: true }]);
  assert.equal(normalizeCarrierEffects([{ name: "(inherent)", disabled: false }]), null);
});

const bands = ["Engaged", "Short", "Medium", "Long", "Extreme"].map((value) => ({ value }));

test("a change-of-skill modifier rolls the weapon with that skill; its own skill is kept", () => {
  const grip = attachment("qa pistol grip", {
    modifications: [modification("qa use ranged light", attr("Weapon Stat", "skill-set", "Ranged: Light"))],
  });
  const item = weapon({ attachments: [grip] });
  item.system.skill = { value: "Ranged: Heavy" };
  const computed = computeItemEffects(item, { rangeBands: bands });
  assert.equal(computed.stats.skill.base, "Ranged: Heavy");
  assert.equal(computed.stats.skill.adjusted, "Ranged: Light");
  assert.deepEqual(computed.stats.skill.sources, [{ name: "qa use ranged light", value: "=Ranged: Light" }]);
  assert.deepEqual(computed.actorChanges, [], "a skill change is not an actor change");

  grip.system.itemmodifier[0].system.active = false;
  assert.equal(computeItemEffects(item, { rangeBands: bands }).stats.skill.adjusted, "Ranged: Heavy", "uninstalled: the weapon's own skill");
});

test("a range cap shortens a longer range and leaves a shorter one alone; it combines with range steps", () => {
  const capped = (base, extra = {}) => {
    const item = weapon({ attachments: [attachment("qa grip", { modifications: [modification("qa medium", attr("Weapon Stat", "range-set", "Medium"))] })], ...extra });
    item.system.range.value = base;
    return computeItemEffects(item, { rangeBands: bands }).stats.range;
  };
  assert.equal(capped("Long").adjusted, "Medium", "Long is capped to Medium");
  assert.equal(capped("Short").adjusted, "Short", "Short is already within the cap");
  // +1 band from a scope, then the cap: Short -> Medium, within the cap; Medium -> Long, capped back to Medium
  assert.equal(capped("Short", { attributes: attr("Weapon Stat", "range", 1) }).adjusted, "Medium");
  assert.equal(capped("Medium", { attributes: attr("Weapon Stat", "range", 1) }).adjusted, "Medium");
});

test("a skill or range change on armour is nothing: neither an item stat nor an actor change", () => {
  const armour = { type: "armour", name: "qa vest", system: { soak: { value: 1 }, defence: { value: 0 }, encumbrance: { value: 2 }, price: { value: 0 }, rarity: { value: 0 }, hardpoints: { value: 1 }, equippable: { equipped: true }, stowed: false, attributes: { ...attr("Weapon Stat", "skill-set", "Ranged: Light"), ...attr("Weapon Stat", "range-set", "Medium") }, itemmodifier: [], itemattachment: [] } };
  const computed = computeItemEffects(armour, { rangeBands: bands });
  assert.deepEqual(computed.actorChanges, []);
  assert.equal(computed.stats.skill, undefined);
});
