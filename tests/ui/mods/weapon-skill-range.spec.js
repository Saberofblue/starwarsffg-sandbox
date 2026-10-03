import { test, expect } from '../../support/fixtures';
import * as api from '../../support/api';

/**
 * Weapon stat modifiers that are words rather than numbers: a change of skill (a pistol grip makes a
 * rifle a Ranged: Light weapon) and a range cap ("no longer than Medium"). And a ship weapon is
 * mounted when it is installed on a vehicle, with a toggle on the vehicle sheet to unmount it.
 */

test('a change-of-skill modification rolls the weapon with that skill and keeps its own', async ({ world, page }) => {
  const ctx = await world.build({
    actor: 'character', item: 'weapon', equipped: true,
    itemOverrides: { skill: { value: 'Ranged: Heavy' } },
    attachment: {
      name: 'qa pistol grip',
      modifications: [
        { name: 'qa use ranged light', key: 'skill-set', modtype: 'Weapon Stat', value: 'Ranged: Light', installed: true },
      ],
    },
  });
  const own = await api.read(page, ctx.item, 'system.skill.value');
  expect(own, 'a rifle').toBe('Ranged: Heavy');
  await expect.poll(() => api.read(page, ctx.item, 'system.skill.adjusted'), 'rolled with the changed skill').toBe('Ranged: Light');
  expect(await api.read(page, ctx.item, 'system.skill.value'), 'its own skill is unchanged').toBe(own);
  expect(await api.read(page, ctx.item, 'system.skill.sources'), 'and says where the change came from')
    .toEqual([{ name: 'qa use ranged light', value: '=Ranged: Light' }]);
});

test('a range cap shortens a longer range and leaves a shorter one alone', async ({ world, page }) => {
  const long = await world.build({
    actor: 'character', item: 'weapon', equipped: true,
    itemOverrides: { range: { value: 'Long' } },
    attachment: { name: 'qa grip', baseMods: [{ modtype: 'Weapon Stat', mod: 'range-set', value: 'Medium' }] },
  });
  await expect.poll(() => api.read(page, long.item, 'system.range.adjusted'), 'Long capped to Medium').toBe('Medium');

  const short = await world.build({
    actor: 'character', item: 'weapon', equipped: true,
    itemOverrides: { range: { value: 'Short' } },
    attachment: { name: 'qa grip', baseMods: [{ modtype: 'Weapon Stat', mod: 'range-set', value: 'Medium' }] },
  });
  await expect.poll(() => api.read(page, short.item, 'system.range.adjusted'), 'Short is within the cap').toBe('Short');
});

test('a ship weapon is mounted when installed on a vehicle, and the vehicle sheet can unmount it', async ({ world, page }) => {
  const ctx = await world.build({ actor: 'vehicle', item: 'shipweapon', equipped: false });
  await expect.poll(() => api.read(page, ctx.item, 'system.equippable.equipped'), 'installing mounts it').toBe(true);

  const windowId = await api.openSheet(page, ctx.actor);
  const toggle = page.locator(`#${windowId} .items .item a.toggle-equipped`).first();
  await expect(toggle, 'the vehicle sheet shows a mount toggle on the weapon').toBeVisible();
  await expect(toggle, 'shown as mounted').toHaveClass(/active/);
  await toggle.click();
  await expect.poll(() => api.read(page, ctx.item, 'system.equippable.equipped'), 'unmounted').toBe(false);
  await api.closeSheet(page, ctx.actor);
});
