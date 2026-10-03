import { test, expect } from '../../support/fixtures';
import * as api from '../../support/api';

/**
 * The Group Manager's obligation and duty tables.
 */

test('the obligation table lists obligation items as well as the legacy list', async ({ world, page }) => {
  // the GM owns every actor, so counting GM characters puts them all in the table
  await world.setSetting('pcListMode', 'owned');
  await world.setSetting('GMCharactersInGroupManager', true);

  const actor = await world.actor({
    actor: 'character',
    label: 'owed',
    actorOverrides: { obligationlist: { legacy1: { type: 'Favour', magnitude: 5 } } },
  });
  // what the sheet's add control, the wizard and the importer make
  await api.createItemOnActor(page, actor, { name: 'Debt', type: 'obligation', system: { type: 'obligation', magnitude: 10 } });
  await api.createItemOnActor(page, actor, { name: 'Sabotage', type: 'obligation', system: { type: 'duty', magnitude: 15 } });

  const table = await page.evaluate(async (uuid) => {
    const owner = await fromUuid(uuid);
    const load = (path) => import(/* @vite-ignore */ `/systems/starwarsffg_sandbox/modules/${path}`);
    const { GroupManager } = await load('groupmanager-ffg.js');
    const data = new GroupManager().getData();
    const mine = (rows) => rows
      .filter((row) => row.playerId === owner.id)
      .map((row) => [row.type, Number(row.magnitude), row.rangeEnd - row.rangeStart + 1]);
    return { obligations: mine(data.obligations), duties: mine(data.duties) };
  }, actor);

  expect(table.obligations, 'the legacy entry and the item, each spanning its magnitude on the d100')
    .toEqual([['Favour', 5, 5], ['Debt', 10, 10]]);
  expect(table.duties, 'duties come from the duty-typed items').toEqual([['Sabotage', 15, 15]]);
});
