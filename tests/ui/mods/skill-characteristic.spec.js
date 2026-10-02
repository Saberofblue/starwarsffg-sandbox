import { test, expect } from '../../support/fixtures';
import * as api from '../../support/api';

/**
 * A talent can change the characteristic a skill is rolled with (Ataru Technique: Lightsaber
 * with Agility instead of Brawn), and a weapon that adds that characteristic to damage follows.
 */

test('a Skill Characteristic modifier changes the characteristic the skill rolls with', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character',
    item: 'talent',
    attributes: [{ modtype: 'Skill Characteristic', mod: 'Lightsaber', value: 'Agility' }],
  });

  // the fixture character has Brawn 3 and Agility 2
  await expect.poll(() => api.read(page, ctx.actor, 'system.skills.Lightsaber.characteristic'), 'the skill now uses Agility').toBe('Agility');
  expect((await consumers.skillPool(ctx, 'Lightsaber')).ability, 'and rolls Agility dice').toBe(2);
});

test('a weapon adding its skill\'s characteristic to damage follows the changed characteristic', async ({ world, consumers, page }) => {
  const ctx = await world.build({
    actor: 'character',
    item: 'weapon',
    equipped: true,
    itemOverrides: { skill: { value: 'Lightsaber' }, characteristic: { value: 'Brawn' }, damage: { value: 0, adjusted: 0 } },
  });
  expect(await consumers.itemAdjusted(ctx, 'Damage'), 'Brawn 3 on its own').toBe(3);

  await world.addItem(ctx, {
    item: 'talent',
    attributes: [{ modtype: 'Skill Characteristic', mod: 'Lightsaber', value: 'Agility' }],
  });
  await expect.poll(() => consumers.itemAdjusted(ctx, 'Damage'), 'Agility 2 once the form technique is learned').toBe(2);
});
