import { test, expect } from '../../../support/fixtures';

/**
 * A base mod can set an item's base stat rather than add to it - a lightsaber crystal's damage.
 */

test('a base-damage mod on an attachment replaces the weapon\'s damage, and ranked mods add to it', async ({ world, consumers }) => {
  const ctx = await world.build({
    actor: 'character',
    item: 'weapon',
    equipped: true,
    attachment: {
      name: 'crystal',
      baseMods: [
        { modtype: 'Weapon Stat', mod: 'damage-set', value: 9 },
        { modtype: 'Weapon Stat', mod: 'critical-set', value: 2 },
      ],
      modifications: [
        { name: 'qa damage', key: 'damage', modtype: 'Weapon Stat', value: 1, rank: 2, installed: true },
        { name: 'qa crit', key: 'critical', modtype: 'Weapon Stat', value: -1, rank: 1, installed: true },
      ],
    },
  });

  expect(await consumers.itemAdjusted(ctx, 'Damage'), 'set to 9, plus two ranks of +1').toBe(9 + 2);
  expect(await consumers.itemAdjusted(ctx, 'Crit'), 'set to 2, less one').toBe(1);
});

test('a base-soak mod on an armour attachment replaces the armour\'s soak', async ({ world, consumers }) => {
  const ctx = await world.build({
    actor: 'character',
    item: 'armour',
    equipped: true,
    attachment: { name: 'insert', baseMods: [{ modtype: 'Armor Stat', mod: 'soak-set', value: 4 }] },
    itemOverrides: { soak: { value: 2, adjusted: 2 }, defence: { value: 0, adjusted: 0 } },
  });

  expect(await consumers.itemAdjusted(ctx, 'Soak'), 'the insert sets the soak').toBe(4);
  expect(await consumers.stat(ctx, 'Soak'), 'and the character gets Brawn plus that').toBe(3 + 4);
});
