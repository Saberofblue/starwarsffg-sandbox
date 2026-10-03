import { test, expect } from '../../support/fixtures';
import * as api from '../../support/api';

/**
 * Drawing a weapon roll's chat card must leave the weapon itself alone. The card is built from a
 * view of the item; writing the card's details onto the live document replaced its prepared data,
 * so every client that drew the message saw the weapon's adjusted damage, range and skill fall
 * back to the stored values until something prepared the item again.
 */

test('rendering a weapon roll card keeps the weapon\'s prepared data', async ({ world, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'weapon', equipped: true,
    attachment: { name: 'qa barrel', baseMods: [{ modtype: 'Weapon Stat', mod: 'damage', value: 2 }] },
  });
  const before = await api.read(page, ctx.item, 'system.damage.adjusted');
  expect(before, 'the attachment raised the damage').toBe(6 + 2);

  await api.rollWeapon(page, ctx.actor, ctx.item);

  // draw the message again, as a client loading the world or scrolling the log does
  const drawn = await page.evaluate(async () => {
    const message = game.messages.contents.at(-1);
    const html = await message.renderHTML();
    return !!html;
  });
  expect(drawn, 'the card rendered').toBe(true);

  expect(await api.read(page, ctx.item, 'system.damage.adjusted'), 'the live weapon still carries its adjusted damage').toBe(before);
  expect(await api.read(page, ctx.item, 'system.range.adjusted'), 'and its range').toBe('Medium');
  expect(await api.read(page, ctx.item, 'system.ffgState.carried'), 'and the rest of its prepared state').toBe(true);
});
