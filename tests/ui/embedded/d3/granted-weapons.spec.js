import { test, expect } from '../../../support/fixtures';
import * as api from '../../../support/api';

/**
 * An item can put a weapon in its owner's hands: an explosives belt's charge, a stun blaster
 * attachment's shot. The weapon comes with the item while it is carried, takes the mods aimed at
 * it, and goes when the item is stowed, taken off or deleted.
 */

const ROCKET = {
  name: 'qa wrist rocket', type: 'weapon',
  system: {
    skill: { value: 'Ranged: Light' }, damage: { value: 8 }, crit: { value: 3 }, range: { value: 'Short' },
    encumbrance: { value: 0 }, equippable: { equipped: true }, itemmodifier: [], attributes: {},
  },
};

const SHOT = {
  name: 'qa stun shot', type: 'weapon',
  system: {
    skill: { value: 'Ranged: Light' }, damage: { value: 5 }, crit: { value: 4 }, range: { value: 'Short' },
    encumbrance: { value: 0 }, equippable: { equipped: true }, itemmodifier: [], attributes: {},
  },
};

/** The weapons an item granted its actor, with what the sheet would show for them. */
const granted = (page, actorUuid, hostUuid) => page.evaluate(async ({ actorUuid, hostUuid }) => {
  const actor = await fromUuid(actorUuid);
  const hostId = hostUuid.split('.').pop();
  return actor.items
    .filter((i) => i.type === 'weapon' && i.getFlag('starwarsffg', 'grantedBy')?.item === hostId)
    .map((i) => ({
      name: i.name,
      damage: i.system.damage.adjusted,
      crit: i.system.crit.adjusted,
      encumbrance: i.system.encumbrance.adjusted,
      equipped: i.system.equippable.equipped,
      grantedBy: i.grantedBy?.name ?? null,
    }));
}, { actorUuid, hostUuid });

/** Rewrite the host's first attachment the way the importer writes a stun blaster: a profile, and a mod aimed at it. */
const setAttachment = async (page, itemUuid, { installed }) => api.update(page, itemUuid, {
  'system.itemattachment': await page.evaluate(async ({ itemUuid, installed, profile }) => {
    const item = await fromUuid(itemUuid);
    const list = foundry.utils.deepClone(item.system.itemattachment);
    list[0].system.grantedWeapons = [profile];
    const mod = list[0].system.itemmodifier[0];
    mod.system.active = installed;
    mod.system.weaponIndex = 0;
    return list;
  }, { itemUuid, installed, profile: SHOT }),
});

test("carried gear puts its weapon in the owner's hands; stowing or deleting the gear takes it back", async ({ world, page }) => {
  const ctx = await world.build({ actor: 'character', item: 'gear', itemOverrides: { grantedWeapons: [ROCKET] } });
  const hostName = await api.read(page, ctx.item, 'name');

  await expect.poll(() => granted(page, ctx.actor, ctx.item), 'the weapon arrives with the gear').toEqual([
    { name: 'qa wrist rocket', damage: 8, crit: 3, encumbrance: 0, equipped: true, grantedBy: hostName },
  ]);

  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => granted(page, ctx.actor, ctx.item), 'stowed: taken back').toEqual([]);

  await api.update(page, ctx.item, { 'system.stowed': false });
  await expect.poll(() => granted(page, ctx.actor, ctx.item), 'carried again: granted again').toHaveLength(1);

  await api.deleteDoc(page, ctx.item);
  await expect.poll(() => page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    return actor.items.filter((i) => i.getFlag('starwarsffg', 'grantedBy')).length;
  }, ctx.actor), 'the gear is gone, and so is its weapon').toBe(0);
});

test("an attachment's weapon takes the mods aimed at it, and the host weapon keeps its own damage", async ({ world, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'weapon', equipped: true,
    attachment: { name: 'stun blaster', modifications: [{ name: 'qa damage mod', key: 'damage', modtype: 'Weapon Stat', value: 1, installed: false }] },
  });
  const hostDamage = () => api.read(page, ctx.item, 'system.damage.adjusted');

  await setAttachment(page, ctx.item, { installed: false });
  await expect.poll(() => granted(page, ctx.actor, ctx.item), 'the attachment grants its weapon').toHaveLength(1);
  expect((await granted(page, ctx.actor, ctx.item))[0].damage, 'at its own damage while the mod is not installed').toBe(5);
  expect(await hostDamage(), 'the host weapon is untouched').toBe(6);

  await setAttachment(page, ctx.item, { installed: true });
  await expect.poll(async () => (await granted(page, ctx.actor, ctx.item))[0]?.damage, 'installed: the mod reaches the granted weapon').toBe(6);
  expect(await hostDamage(), 'and not the host').toBe(6);

  await setAttachment(page, ctx.item, { installed: false });
  await expect.poll(async () => (await granted(page, ctx.actor, ctx.item))[0]?.damage, 'uninstalled: back to its own damage').toBe(5);

  await world.equip(ctx, false);
  await expect.poll(() => granted(page, ctx.actor, ctx.item), 'the host put away: the attachment grants nothing').toEqual([]);
});
