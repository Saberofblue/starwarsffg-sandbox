import { test, expect } from '../../../support/fixtures';
import * as api from '../../../support/api';

/**
 * Armour does not stack: of the armour a character wears, only the piece with the highest soak
 * grants soak and only the piece with the highest defence grants defence, judged separately. The
 * other pieces still count for encumbrance and still carry their mods.
 */

test('a second worn armour grants only what beats the first, stat by stat', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 2, adjusted: 2 }, defence: { value: 1, adjusted: 1 } },
  });
  expect(await consumers.stat(ctx, 'Soak'), 'brawn 3 and the armour').toBe(3 + 2);
  expect(await consumers.stat(ctx, 'Defence-Melee'), 'its defence').toBe(1);

  // a jacket with less soak but more defence, worn over it
  const jacket = await world.addItem(ctx, {
    item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 1, adjusted: 1 }, defence: { value: 2, adjusted: 2 } },
  });
  await expect.poll(() => consumers.stat(ctx, 'Defence-Melee'), 'the jacket has the better defence').toBe(2);
  expect(await consumers.stat(ctx, 'Defence-Ranged'), 'ranged likewise').toBe(2);
  expect(await consumers.stat(ctx, 'Soak'), 'the first armour still has the better soak; the two do not add').toBe(3 + 2);

  // stow the first: the jacket is the only armour worn
  await api.update(page, ctx.item, { 'system.stowed': true });
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'the jacket alone').toBe(3 + 1);
  expect(await consumers.stat(ctx, 'Defence-Melee'), 'its defence stays').toBe(2);

  // take the jacket off too
  await api.update(page, jacket.item, { 'system.equippable.equipped': false });
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'unarmoured').toBe(3);
  expect(await consumers.stat(ctx, 'Defence-Melee'), 'no defence').toBe(0);
});

test('two worn armours of equal soak grant it once', async ({ world, consumers }) => {
  const ctx = await world.build({
    actor: 'character', item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 2, adjusted: 2 }, defence: { value: 0, adjusted: 0 } },
  });
  await world.addItem(ctx, {
    item: 'armour', equipped: true,
    itemOverrides: { soak: { value: 2, adjusted: 2 }, defence: { value: 0, adjusted: 0 } },
  });
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'brawn 3 and one armour, not two').toBe(3 + 2);
});
