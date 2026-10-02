import assert from "node:assert/strict";
import test from "node:test";

globalThis.FormApplication ??= class {};
globalThis.CONFIG ??= { logger: { debug() {}, warn() {}, error() {} } };

const { storageSlots, assignStorage, canStore, storedAwayIds } = await import("../../modules/helpers/storage.js");

const holster = (rank, encLimit = 3, extra = {}) => ({
  name: "Holster", system: { rank, active: true, storage: { encLimit, types: ["weapon"], skills: [], ...extra } },
});
const weapon = (id, encumbrance, skill = "Ranged: Light") =>
  ({ id, type: "weapon", system: { encumbrance: { value: encumbrance, adjusted: encumbrance }, skill: { value: skill } } });
const armour = (id, { qualities = [], modifications = [], stowed = false, storedIn = "" } = {}) => ({
  id, type: "armour",
  system: { stowed, storedIn, itemmodifier: qualities, itemattachment: [{ name: "Integrated Holsters", system: { itemmodifier: modifications } }] },
});

test("storage slots come from qualities and installed modifications, one per rank", () => {
  const host = armour("a", {
    qualities: [holster(1)],
    modifications: [holster(2, 4), { ...holster(1), system: { ...holster(1).system, active: false } }],
  });
  const slots = storageSlots(host);
  assert.deepEqual(slots.map((s) => [s.encLimit, s.count]), [[3, 1], [4, 2]]);
});

test("limits on encumbrance, type and skill are honoured, and MOUNTADDL raises the limit", () => {
  const host = armour("a", { qualities: [holster(1, 3, { skills: ["Ranged: Light"] })] });
  assert.ok(canStore(host, weapon("w1", 3)));
  assert.ok(!canStore(host, weapon("w2", 4)), "too heavy");
  assert.ok(!canStore(host, weapon("w3", 1, "Melee")), "wrong skill");
  assert.ok(!canStore(host, { id: "g", type: "gear", system: { encumbrance: { value: 1 } } }), "wrong type");
  const raised = armour("b", { qualities: [holster(1, 3), { name: "Mount Addl", system: { rank: 1, storage: { addlEnc: 1 } } }] });
  assert.ok(canStore(raised, weapon("w2", 4)));
});

test("assignment is greedy and respects slot counts", () => {
  const host = armour("a", { qualities: [holster(2)] });
  const fits = assignStorage(host, [weapon("w1", 1), weapon("w2", 2), weapon("w3", 3)]);
  assert.deepEqual([...fits], ["w1", "w2"]);
  assert.ok(!canStore(host, weapon("w3", 3), [weapon("w1", 1), weapon("w2", 2)]));
});

test("items stored on a carried host weigh nothing; a stowed host releases them", () => {
  const host = armour("a", { qualities: [holster(2)] });
  const items = [host, { ...weapon("w1", 2), system: { ...weapon("w1", 2).system, storedIn: "a" } }, weapon("w2", 2)];
  assert.deepEqual([...storedAwayIds(items)], ["w1"]);
  host.system.stowed = true;
  assert.deepEqual([...storedAwayIds(items)], []);
  host.system.stowed = false;
  items[1].system.storedIn = "missing";
  assert.deepEqual([...storedAwayIds(items)], []);
});
