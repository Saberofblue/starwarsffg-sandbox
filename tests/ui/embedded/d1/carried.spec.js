import { test, expect } from '../../../support/fixtures';
import * as api from '../../../support/api';

/**
 * What a character carries: stowed items contribute nothing, items stored in a holster or pouch
 * on carried equipment weigh nothing, and a threshold bonus follows its gear being carried.
 */

const itemId = (uuid) => uuid.split('.').pop();

test('a stowed weapon stops counting toward encumbrance until it is carried again', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'weapon', equipped: false,
    itemOverrides: { encumbrance: { value: 5, adjusted: 5 } },
  });
  expect(await consumers.stat(ctx, 'Encumbrance'), 'carried').toBe(5);

  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'stowed').toBe(0);

  await api.update(page, ctx.item, { 'system.stowed': false });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'carried again').toBe(5);
});

test('stowing worn armour takes it off, and equipping it again carries it', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 2, adjusted: 2 }, defence: { value: 0, adjusted: 0 }, encumbrance: { value: 5, adjusted: 5 } },
  });
  expect(await consumers.stat(ctx, 'Soak'), 'worn armour adds soak').toBe(3 + 2);
  expect(await consumers.stat(ctx, 'Encumbrance'), 'worn armour counts three less').toBe(5 - 3);

  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'stowed armour grants nothing').toBe(3);
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'stowed armour weighs nothing').toBe(0);
  expect(await api.read(page, ctx.item, 'system.equippable.equipped'), 'stowing unequips').toBe(false);

  await api.update(page, ctx.item, { 'system.equippable.equipped': true });
  expect(await api.read(page, ctx.item, 'system.stowed'), 'equipping un-stows').toBe(false);
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'worn again').toBe(3 + 2);
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'counted again').toBe(5 - 3);
});

test('a threshold bonus on gear applies per rank while the gear is carried', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'gear',
    modifier: { name: 'qa threshold', key: 'EncumbranceMax', value: 1, rank: 4 },
    actorOverrides: { stats: { encumbrance: { max: 10 } } },
  });
  await expect.poll(() => consumers.stat(ctx, 'EncumbranceMax'), 'four ranks of +1').toBe(10 + 4);
  expect(await consumers.stat(ctx, 'Encumbrance'), 'the gear itself is carried').toBe(2);

  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => consumers.stat(ctx, 'EncumbranceMax'), 'a stowed backpack grants nothing').toBe(10);
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'and weighs nothing').toBe(0);
});

test('a weapon stored in a holster on carried armour weighs nothing', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 0, adjusted: 0 }, defence: { value: 0, adjusted: 0 }, encumbrance: { value: 5, adjusted: 5 } },
  });
  // two holsters for weapons of encumbrance 3 or less, as Integrated Holsters' base mod grants
  const qualities = (await api.read(page, ctx.item, 'system.itemmodifier')) ?? [];
  await api.update(page, ctx.item, {
    'system.itemmodifier': [...qualities, {
      name: 'qa holster', type: 'itemmodifier',
      system: { rank: 2, active: true, type: 'armour', attributes: {}, storage: { encLimit: 3, types: ['weapon'], skills: [] } },
    }],
  });
  const pistol = await world.addItem(ctx, { item: 'weapon', equipped: false, itemOverrides: { encumbrance: { value: 3, adjusted: 3 } } });
  const rifle = await world.addItem(ctx, { item: 'weapon', equipped: false, itemOverrides: { encumbrance: { value: 4, adjusted: 4 } } });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'armour worn plus both weapons').toBe((5 - 3) + 3 + 4);

  await api.update(page, pistol.item, { 'system.storedIn': itemId(ctx.item) });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'the holstered pistol weighs nothing').toBe((5 - 3) + 4);

  await api.update(page, rifle.item, { 'system.storedIn': itemId(ctx.item) });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'the rifle is too heavy for a holster and still counts').toBe((5 - 3) + 4);

  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'stowing the armour releases what it held').toBe(0 + 3 + 4);

  await api.update(page, ctx.item, { 'system.stowed': false });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'carrying it again (unworn) holds the pistol again').toBe(5 + 4);
});
