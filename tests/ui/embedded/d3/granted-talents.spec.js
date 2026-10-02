import { test, expect } from '../../../support/fixtures';
import * as api from '../../../support/api';

/**
 * A modification can grant a talent while it is installed on a carried item (Integrated
 * Holsters' Quick Draw). The talent leaves with the modification, the attachment, or the item.
 */

const grantedTalents = async (page, actorUuid, itemUuid) => page.evaluate(async ({ actorUuid, itemUuid }) => {
  const actor = await fromUuid(actorUuid);
  const itemId = itemUuid.split('.').pop();
  return actor.items
    .filter((i) => i.type === 'talent' && i.getFlag('starwarsffg', 'grantedBy')?.item === itemId)
    .map((i) => i.name);
}, { actorUuid, itemUuid });

const setGrant = async (page, itemUuid, installed) => api.update(page, itemUuid, {
  'system.itemattachment': await page.evaluate(async ({ itemUuid, installed }) => {
    const item = await fromUuid(itemUuid);
    const list = foundry.utils.deepClone(item.system.itemattachment);
    const mod = list[0].system.itemmodifier[0];
    mod.system.active = installed;
    mod.system.grants = { type: 'talent', key: 'QUICKDR', name: 'Quick Draw' };
    return list;
  }, { itemUuid, installed }),
});

test('an installed modification grants its talent, and uninstalling it takes the talent back', async ({ world, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    attachment: { name: 'holsters', modifications: [{ name: 'qa quick draw', key: 'Soak', value: 0, installed: false }] },
  });
  const quickDraw = await api.read(page, await world.imported('talent', 'QUICKDR'), 'name');

  expect(await grantedTalents(page, ctx.actor, ctx.item), 'nothing granted yet').toEqual([]);

  await setGrant(page, ctx.item, true);
  await expect.poll(() => grantedTalents(page, ctx.actor, ctx.item), 'installed: the talent arrives').toEqual([quickDraw]);

  await setGrant(page, ctx.item, false);
  await expect.poll(() => grantedTalents(page, ctx.actor, ctx.item), 'uninstalled: the talent goes').toEqual([]);
});

test('a granted talent follows the item being worn, and leaves with the item', async ({ world, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    attachment: { name: 'holsters', modifications: [{ name: 'qa quick draw', key: 'Soak', value: 0, installed: false }] },
  });
  await setGrant(page, ctx.item, true);
  await expect.poll(() => grantedTalents(page, ctx.actor, ctx.item)).toHaveLength(1);

  await world.equip(ctx, false);
  await expect.poll(() => grantedTalents(page, ctx.actor, ctx.item), 'taken off: not granted').toEqual([]);

  await world.equip(ctx, true);
  await expect.poll(() => grantedTalents(page, ctx.actor, ctx.item), 'worn again: granted').toHaveLength(1);

  await api.deleteDoc(page, ctx.item);
  await expect.poll(() => page.evaluate(async (actorUuid) => {
    const actor = await fromUuid(actorUuid);
    return actor.items.filter((i) => i.type === 'talent' && i.getFlag('starwarsffg', 'grantedBy')).length;
  }, ctx.actor), 'the item is gone, and so is what it granted').toBe(0);
});
