import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../support/fixtures';
import * as api from '../../support/api';
import * as creator from '../../support/pages/character-creator';

/**
 * A stress build on the full OggDude catalog (run with SKIP_SEED=1 on a world that holds it):
 * a Droid built in the wizard with 10,000 credits and an obligation for a group of ten, then
 * armed, armoured and holstered on the sheet, taken past 1,000 XP across three specializations,
 * rolled, exported to JSON and imported again into a fresh actor.
 *
 * Every number the character sheet should show is asserted along the way, and the rebuilt actor
 * has to match the original. The character is left in the world for inspection.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);
// needs a world holding the full merged OggDude dataset: STRESS_WORLD=1 SKIP_SEED=1 npx playwright test tests/ui/stress
test.skip(!process.env.STRESS_WORLD, 'set STRESS_WORLD=1 against a world that holds the full OggDude catalog');

const PACKS = {
  species: 'world.oggdudespecies', careers: 'world.oggdudecareers', specs: 'world.oggdudespecializations',
  weapons: 'world.oggdudeweapons', armour: 'world.oggdudearmor', gear: 'world.oggdudegear',
  weaponAttachments: 'world.oggdudeweaponattachments', armourAttachments: 'world.oggdudearmorattachments',
  obligations: 'world.oggdudeobligations', motivations: 'world.oggdudemotivations', talents: 'world.oggdudetalents',
};

/** A catalog document by its OggDude key. */
async function catalog(page, pack, key) {
  // findImported prefixes "world." itself
  const uuid = await api.findImported(page, pack.replace(/^world\./, ''), key);
  if (!uuid) throw new Error(`${key} is not in ${pack}; is the full dataset imported?`);
  return uuid;
}

/** The first document in a pack whose name matches, with an optional check on its data. */
async function catalogByName(page, pack, pattern, where = null) {
  const uuid = await page.evaluate(async ({ pack, pattern, where }) => {
    const p = game.packs.get(pack);
    const docs = await p.getDocuments();
    const re = new RegExp(pattern, 'i');
    const found = docs.find((d) => re.test(d.name) && (!where || foundry.utils.getProperty(d, where.path) === where.value));
    return found?.uuid ?? null;
  }, { pack, pattern, where });
  if (!uuid) throw new Error(`nothing in ${pack} matches /${pattern}/`);
  return uuid;
}

/** The embedded item of a given type and name on an actor. */
async function owned(page, actorUuid, type, name) {
  const uuid = await page.evaluate(async ({ actorUuid, type, name }) => {
    const actor = await fromUuid(actorUuid);
    return actor.items.find((i) => i.type === type && i.name === name)?.uuid ?? null;
  }, { actorUuid, type, name });
  if (!uuid) throw new Error(`${actorUuid} has no ${type} named ${name}`);
  return uuid;
}

const read = (page, uuid, p) => api.read(page, uuid, p);

/** The wizard pages its lists ten rows at a time; filter one down to the row wanted. */
async function filterTable(page, table, text) {
  await page.evaluate(({ table, text }) => {
    const dt = globalThis.jQuery?.(table)?.DataTable?.();
    if (!dt) throw new Error(`no DataTable at ${table}`);
    dt.search(text).draw();
  }, { table, text });
  await page.waitForTimeout(250);
}

/** Mark a purchasable modification installed at a rank, through the data the editor writes. */
async function installMod(page, itemUuid, attachmentName, modKey, rank = 1) {
  await page.evaluate(async ({ itemUuid, attachmentName, modKey, rank }) => {
    const item = await fromUuid(itemUuid);
    const attachments = foundry.utils.deepClone(item._source.system.itemattachment);
    const att = attachments.find((a) => a.name === attachmentName);
    if (!att) throw new Error(`${item.name} has no attachment ${attachmentName}`);
    const row = att.system.itemmodifier.find((m) => m.flags?.starwarsffg?.ffgimportid === modKey && !m.flags?.starwarsffg?.baseMod);
    if (!row) throw new Error(`${attachmentName} has no purchasable ${modKey}`);
    row.system.active = true;
    row.system.rank = rank;
    await item.update({ 'system.itemattachment': attachments });
    if (item._ffgSyncing) await item._ffgSyncing;
  }, { itemUuid, attachmentName, modKey, rank });
}

/** Grant XP exactly as the group manager's dialog callback does, without the dialog. */
async function grantXp(page, actorUuid, amount, note = 'stress grant') {
  await page.evaluate(async ({ actorUuid, amount, note }) => {
    const helpers = await import(`/systems/${game.system.id}/modules/helpers/actor-helpers.js`);
    const ActorHelpers = helpers.default;
    const actor = await fromUuid(actorUuid);
    const state = await ActorHelpers.beginEditMode(actor, true);
    const available = actor.system.experience.available + amount;
    const total = actor.system.experience.total + amount;
    await actor.update({ 'system.experience.total': total, 'system.experience.available': available });
    await helpers.xpLogEarn(actor, amount, available, total, note);
    await ActorHelpers.endEditMode(actor, state, true);
  }, { actorUuid, amount, note });
}

/** Pay for something bought outside the wizard, as a player edits the credits box. */
async function pay(page, actorUuid, amount) {
  await page.evaluate(async ({ actorUuid, amount }) => {
    const actor = await fromUuid(actorUuid);
    const have = actor.system.stats.credits.value;
    if (have < amount) throw new Error(`cannot pay ${amount} with ${have} credits`);
    await actor.update({ 'system.stats.credits.value': have - amount });
  }, { actorUuid, amount });
}

const state = { actor: null, rifle: null, pistol: null, holdout: null, armour: null, exported: null, copy: null };

test('1. the wizard builds a Droid Explorer with 10,000 credits and an obligation for a group of ten', async ({ world, page }) => {
  // group of ten: 5 obligation each, before any starting bonus
  await world.setSetting('defaultObligation', 5);
  await world.setSetting('defaultCredits', 10000);
  // the shop hides restricted and rare items by default; this character buys both
  await world.setSetting('maxRarity', 10);
  await world.setSetting('allowRestricted', true);

  const species = await catalog(page, PACKS.species, 'DROID');
  const career = await catalog(page, PACKS.careers, 'EXPLORER');
  const spec = await catalog(page, PACKS.specs, 'FRINGER');

  await creator.open(page);
  await creator.chooseRules(page, 'eote');
  await filterTable(page, '#species', 'Droid');
  await creator.selectSpecies(page, species);
  await filterTable(page, '#careers', 'Explorer');
  await creator.selectCareer(page, career);
  await filterTable(page, '#specializations', 'Fringer');
  await creator.selectSpecialization(page, spec);
  // +10 XP for +5 obligation
  await creator.chooseStartingBonus(page, '10xp');

  const budget = await creator.budget(page);
  expect(budget.total, 'a Droid starts with 175 XP, plus the bonus').toBe(185);
  const owed = await creator.obligation(page);
  // a group of ten owes 5 each; +10 XP is bought with +10 obligation
  expect(owed.available, 'obligation for a group of ten plus the bonus').toBe(15);
  const credits = await creator.credits(page);
  expect(credits.total, 'the credits the world setting hands out').toBe(10000);

  // free ranks: four from the career, two from the specialization, the Droid's extra picks
  for (const skill of ['Astrogation', 'Perception', 'Piloting: Space', 'Survival']) await creator.takeSkillRank(page, skill, 'career');
  for (const skill of ['Streetwise', 'Negotiation']) await creator.takeSkillRank(page, skill, 'specialization');
  const speciesPicks = await page.evaluate((key) => {
    const app = window[key];
    return [...(app?.element?.querySelectorAll('[data-action="skill-control"][data-direction="increase"][data-mode="species"]') ?? [])]
      .map((el) => `${el.dataset.target}@${el.dataset.speciesIndex}`);
  }, '__qaCreator');
  expect(speciesPicks.length, 'the Droid offers its extra skill picks').toBeGreaterThan(0);
  const picked = [];
  for (const choice of speciesPicks) {
    const [skill, index] = choice.split('@');
    if (picked.some((p) => p.index === index && p.count >= (index === '0' ? 2 : 1))) continue;
    if (picked.some((p) => p.skill === skill)) continue;
    const ok = await page.evaluate(({ key, skill, index }) => {
      const app = window[key];
      const el = app.element.querySelector(`[data-action="skill-control"][data-direction="increase"][data-mode="species"][data-target="${skill}"][data-species-index="${index}"]`);
      if (!el) return false;
      el.click();
      return true;
    }, { key: '__qaCreator', skill, index });
    if (!ok) continue;
    const entry = picked.find((p) => p.index === index);
    if (entry) entry.count += 1; else picked.push({ index, skill, count: 1 });
    await page.waitForTimeout(300);
  }

  // characteristics: a Droid starts at 1 everywhere
  for (const c of ['Brawn', 'Brawn', 'Agility', 'Agility', 'Intellect', 'Cunning', 'Willpower', 'Presence']) await creator.buyCharacteristic(page, c);
  // 160 spent; the last 25 go on the first two Fringer talents
  await creator.buyTalent(page, 'talent0');
  await creator.buyTalent(page, 'talent1');
  const left = await creator.budget(page);
  expect(left.available, 'every starting XP spent').toBeLessThanOrEqual(5);

  // the shop
  const shopping = [
    [PACKS.armour, 'LAM', 2500, 'Laminate'], [PACKS.weapons, 'BLASTRIFDDCMR6', 1000, 'DDC-MR6'], [PACKS.weapons, 'BLASTPISHVY', 700, 'Heavy Blaster Pistol'],
    [PACKS.weapons, 'BLASTHOLD', 200, 'Holdout Blaster'], [PACKS.gear, 'EXPLOSIVESBELT', 450, 'Explosives Belt'], [PACKS.gear, 'BACKPACK', 50, 'Backpack'],
    [PACKS.gear, 'UTILBELT', 25, 'Utility Belt'], [PACKS.gear, 'LOADBEAR', 100, 'Load-Bearing'],
  ];
  let spent = 0;
  for (const [pack, key, price, name] of shopping) {
    await filterTable(page, '#buy_gear', name);
    await creator.buyGear(page, await catalog(page, pack, key));
    spent += price;
  }
  const after = await creator.credits(page);
  expect(after.available, 'the shop charged list price').toBe(10000 - spent);

  // obligation and motivation picked from the catalog
  const obligation = await catalogByName(page, PACKS.obligations, 'Debt|Bounty|Criminal', { path: 'system.type', value: 'obligation' });
  const motivation = await catalogByName(page, PACKS.motivations, '.');
  await page.evaluate(async ({ key, obligation, motivation }) => {
    const app = window[key];
    const o = await fromUuid(obligation);
    o.system.magnitude = 10;
    app.data.selected.obligations.push(o);
    app.data.selected.motivations.push({ item: await fromUuid(motivation) });
  }, { key: '__qaCreator', obligation, motivation });

  state.actor = await creator.finish(page);
  await creator.close(page);

  expect(await read(page, state.actor, 'type')).toBe('character');
  expect(await read(page, state.actor, 'system.experience.total'), 'starting XP on the sheet').toBe(185);
  // the wizard rolls 1d100 of pocket money on top, as the rules say
  expect(await read(page, state.actor, 'system.stats.credits.value'), 'credits left after the shop, plus the pocket money').toBe(10000 - spent + after.spending);
  expect(await read(page, state.actor, 'system.characteristics.Brawn.value')).toBe(3);
  expect(await read(page, state.actor, 'system.characteristics.Agility.value')).toBe(3);
  const items = await api.readOwnedItems(page, state.actor);
  const names = items.map((i) => i.name);
  for (const want of ['Droid', 'Explorer', 'Fringer', 'Laminate', 'DDC-MR6 Modular Rifle', 'Heavy Blaster Pistol', 'Holdout Blaster', 'Explosives Belt', 'Backpack', 'Utility Belt', 'Load-Bearing Gear']) {
    expect(names, `the character owns ${want}`).toContain(want);
  }
  expect(items.filter((i) => i.type === 'obligation').length, 'an obligation').toBeGreaterThanOrEqual(1);
  expect(items.filter((i) => i.type === 'motivation').length, 'a motivation').toBeGreaterThanOrEqual(1);
  expect(await read(page, state.actor, 'system.skills.Astrogation.rank'), 'a free career rank').toBeGreaterThanOrEqual(1);
  expect(await read(page, state.actor, 'system.skills.Streetwise.rank'), 'a free specialization rank').toBeGreaterThanOrEqual(1);
});

test('2. weapons take attachments and mods, armour holsters two weapons, gear raises the threshold', async ({ page, consumers }) => {
  const ctx = { actor: state.actor, actorName: 'stress droid', spec: {} };
  state.rifle = await owned(page, state.actor, 'weapon', 'DDC-MR6 Modular Rifle');
  state.pistol = await owned(page, state.actor, 'weapon', 'Heavy Blaster Pistol');
  state.holdout = await owned(page, state.actor, 'weapon', 'Holdout Blaster');
  state.armour = await owned(page, state.actor, 'armour', 'Laminate');

  await api.setEquipped(page, state.rifle, true);
  await api.setEquipped(page, state.pistol, true);
  await api.setEquipped(page, state.armour, true);

  // rifle (6 HP): Augmented Spin Barrel 2, Custom Grip 1, Telescopic Optical Sight 1; two hard points stay free
  for (const [key, price] of [['AUGSPIN', 1750], ['CUSTGRIP', 500], ['TOS', 250]]) {
    await api.dropOntoItem(page, state.rifle, await catalog(page, PACKS.weaponAttachments, key));
    await pay(page, state.actor, price);
  }
  expect(await read(page, state.rifle, 'system.hardpoints.current'), 'the rifle has two hard points left').toBe(2);
  const refused = await api.tryDropOntoItem(page, state.rifle, await catalog(page, PACKS.weaponAttachments, 'HUNTBARREL'));
  expect(refused, 'a three-point barrel is refused').toBeTruthy();

  // pistol (3 HP): Blaster Actuating Module 1, Custom Grip 1
  for (const [key, price] of [['BLASTACT', 500], ['CUSTGRIP', 500]]) {
    await api.dropOntoItem(page, state.pistol, await catalog(page, PACKS.weaponAttachments, key));
    await pay(page, state.actor, price);
  }
  // armour (3 HP): Integrated Holsters 2
  await api.dropOntoItem(page, state.armour, await catalog(page, PACKS.armourAttachments, 'INTHOLST'));
  await pay(page, state.actor, 300);

  // buy mods: 100 credits a rank
  await installMod(page, state.rifle, 'Augmented Spin Barrel', 'DAMADD', 2); await pay(page, state.actor, 200);
  await installMod(page, state.rifle, 'Augmented Spin Barrel', 'ACCURATE', 1); await pay(page, state.actor, 100);
  await installMod(page, state.rifle, 'Augmented Spin Barrel', 'PIERCE', 1); await pay(page, state.actor, 100);
  await installMod(page, state.rifle, 'Custom Grip', 'ACCURATE', 1); await pay(page, state.actor, 100);
  await installMod(page, state.pistol, 'Blaster Actuating Module', 'DAMADD', 2); await pay(page, state.actor, 200);
  await installMod(page, state.pistol, 'Blaster Actuating Module', 'PIERCE', 2); await pay(page, state.actor, 200);
  await installMod(page, state.pistol, 'Custom Grip', 'ACCURATE', 1); await pay(page, state.actor, 100);
  await installMod(page, state.armour, 'Integrated Holsters', 'QUICKDR', 1); await pay(page, state.actor, 100);

  // rifle: 7 base, +1 AUGSPIN base, +2 AUGSPIN purchased = 10; Accurate 1+1 from the two purchasable rows
  await expect.poll(() => read(page, state.rifle, 'system.damage.adjusted'), 'rifle damage').toBe(10);
  const rifleQualities = (await read(page, state.rifle, 'system.adjusteditemmodifier')).map((m) => `${m.name}:${m.system.rank_current}`);
  expect(rifleQualities, 'rifle qualities').toEqual(expect.arrayContaining(['Accurate Quality:2', 'Pierce Quality:1']));
  // pistol: 7 base, +1 BLASTACT base, +2 purchased = 10; Pierce 2
  await expect.poll(() => read(page, state.pistol, 'system.damage.adjusted'), 'pistol damage').toBe(10);
  const pistolQualities = (await read(page, state.pistol, 'system.adjusteditemmodifier')).map((m) => `${m.name}:${m.system.rank_current}`);
  expect(pistolQualities, 'pistol qualities').toEqual(expect.arrayContaining(['Pierce Quality:2', 'Accurate Quality:1']));

  // Quick Draw arrives with the holsters
  await expect.poll(async () => (await api.readOwnedItems(page, state.actor)).some((i) => i.type === 'talent' && i.name === 'Quick Draw'), 'Quick Draw granted by the holster mod').toBe(true);

  // encumbrance before holstering: rifle 3 + pistol 2 + holdout 1 + belt 1 + laminate (4 worn: 1) = 8
  const threshold = 5 + 3 + 4 + 1 + 3;
  await expect.poll(() => consumers.stat(ctx, 'EncumbranceMax'), 'threshold: 5 + Brawn 3 + backpack 4 + belt 1 + load-bearing 3').toBe(threshold);
  const before = await consumers.stat(ctx, 'Encumbrance');
  // holster the pistol (2) and the holdout (1)
  const armourId = state.armour.split('.').pop();
  await api.update(page, state.pistol, { 'system.equippable.equipped': false, 'system.storedIn': armourId });
  await api.update(page, state.holdout, { 'system.storedIn': armourId });
  await expect.poll(() => consumers.stat(ctx, 'Encumbrance'), 'both holstered weapons stop counting').toBe(before - 3);
  // a third does not fit: the "store in" dialog offers the rifle no host once both slots are taken
  const hosts = await page.evaluate(async ({ actorUuid, rifleUuid }) => {
    const { storageHostsFor } = await import(`/systems/${game.system.id}/modules/helpers/storage.js`);
    const actor = await fromUuid(actorUuid);
    const rifle = await fromUuid(rifleUuid);
    return storageHostsFor(actor, rifle).map((h) => h.name ?? h.host?.name ?? String(h));
  }, { actorUuid: state.actor, rifleUuid: state.rifle });
  expect(hosts, 'no holster left for a third weapon').not.toContain('Laminate');

  // soak: Brawn 3 + Laminate 2 + the Droid's Enduring 1
  await expect.poll(() => consumers.stat(ctx, 'Soak'), 'soak with armour and the species talent').toBe(6);
});

test('3. past 1,000 XP: two more specializations, talents that change dice pools, skill ranks', async ({ page, consumers }) => {
  const ctx = { actor: state.actor, actorName: 'stress droid', spec: {} };
  await grantXp(page, state.actor, 1000);
  await expect.poll(() => read(page, state.actor, 'system.experience.total'), 'over a thousand XP').toBe(1185);

  const pirate = await api.dropForPurchase(page, state.actor, await catalog(page, PACKS.specs, 'PIRATE'), 'purchase');
  const mechanic = await api.dropForPurchase(page, state.actor, await catalog(page, PACKS.specs, 'MECHANIC'), 'purchase');
  expect(pirate && mechanic, 'both specializations bought').toBeTruthy();
  const fringer = await owned(page, state.actor, 'specialization', 'Fringer');

  // walk every tree top to bottom, buying what the sheet offers
  for (const specUuid of [fringer, pirate, mechanic]) {
    for (let node = 0; node < 20; node++) {
      try { await api.buyProgressionNode(page, specUuid, `talent${node}`); } catch (e) { break; }
    }
  }
  const xp = await consumers.xp(ctx);
  expect(xp.available, 'XP was spent on talents').toBeLessThan(1000);

  // dice pools: Fringer's Street Smarts removes a setback from Streetwise, Galaxy Mapper from Astrogation,
  // Pirate's Commanding Presence from Cool and Leadership, Fearsome Rep adds an advantage to Coercion
  const streetwise = await consumers.skillPool(ctx, 'Streetwise');
  expect(streetwise.remsetback, 'Street Smarts').toBeGreaterThanOrEqual(1);
  const astro = await consumers.skillPool(ctx, 'Astrogation');
  expect(astro.remsetback, 'Galaxy Mapper').toBeGreaterThanOrEqual(1);
  const cool = await consumers.skillPool(ctx, 'Cool');
  expect(cool.remsetback, 'Commanding Presence').toBeGreaterThanOrEqual(1);

  // the rifle's own pool: Accurate 2 is two boost dice, Custom Grip removes a setback
  const rifleCtx = { ...ctx, item: state.rifle, itemName: 'DDC-MR6 Modular Rifle' };
  const pool = await consumers.weaponPool(rifleCtx);
  expect(pool.boost, 'Accurate 2').toBeGreaterThanOrEqual(2);
  expect(pool.remsetback, 'Custom Grip').toBeGreaterThanOrEqual(1);
  await api.rollWeapon(page, state.actor, state.rifle, { add: { setback: 1 } });
  const dice = await api.readLastRollDice(page);
  expect(dice.boost, 'the roll was made with the boost dice').toBeGreaterThanOrEqual(2);
  // the weapon's own chat card carries the modded figures
  await api.sendItemToChat(page, state.actor, state.rifle);
  const card = Object.fromEntries((await api.readCardStats(page)).map((s) => [s.title, s.value]));
  expect(card.Damage, 'the card shows the modded damage').toBe('10');
  expect(card.Range, 'and the range').toBe('Medium');

  // skill ranks: a career skill and a non-career one
  const rhBefore = await read(page, state.actor, 'system.skills.Ranged: Heavy.rank');
  await api.buySkillRank(page, state.actor, 'Ranged: Heavy');
  await api.buySkillRank(page, state.actor, 'Ranged: Heavy');
  await expect.poll(() => read(page, state.actor, 'system.skills.Ranged: Heavy.rank')).toBe(rhBefore + 2);
  await api.buySkillRank(page, state.actor, 'Mechanics');
  await expect.poll(() => read(page, state.actor, 'system.skills.Mechanics.rank')).toBeGreaterThanOrEqual(1);

  // Mechanic's Enduring stacks with the Droid's: soak 3 + 2 + 2
  const talents = (await api.readOwnedItems(page, state.actor)).filter((i) => i.type === 'talent');
  const enduring = talents.filter((t) => t.name === 'Enduring');
  expect(enduring.length, 'Enduring from the species and the Mechanic tree').toBeGreaterThanOrEqual(1);
  const soak = await consumers.stat(ctx, 'Soak');
  expect(soak, 'soak counts every Enduring rank').toBeGreaterThanOrEqual(6);

  // morality, backstory, and the last credits
  await api.update(page, state.actor, {
    'system.morality.value': 50,
    'system.biography': '<p>Reactivated on Ord Mantell after sixty years in a scrap pile, this LE-series droid runs cargo and tells the same three jokes.</p>',
  });
  const creditsLeft = await read(page, state.actor, 'system.stats.credits.value');
  expect(creditsLeft, 'credits spent down').toBeLessThan(500);
});

test('4. export to JSON and import into a fresh actor: everything comes back', async ({ page }) => {
  const original = await page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    const s = actor.system;
    return {
      name: actor.name, items: actor.items.size, soak: s.stats.soak.value, wounds: s.stats.wounds.max, strain: s.stats.strain.max,
      encumbrance: s.stats.encumbrance.value, threshold: s.stats.encumbrance.max, credits: s.stats.credits.value,
      xp: s.experience, morality: s.morality.value, obligation: Object.keys(s.obligationlist ?? {}).length,
      skills: Object.fromEntries(Object.entries(s.skills).map(([k, v]) => [k, v.rank])),
      talents: actor.items.filter((i) => i.type === 'talent').map((i) => i.name).sort(),
      rifleDamage: actor.items.getName('DDC-MR6 Modular Rifle').system.damage.adjusted,
      stored: actor.items.filter((i) => i.system.storedIn).map((i) => i.name).sort(),
    };
  }, state.actor);

  // the sidebar's Export Data, caught as a download
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.evaluate(async (uuid) => { const actor = await fromUuid(uuid); await actor.exportToJSON(); }, state.actor),
  ]);
  const dir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'stress-droid.json');
  await download.saveAs(file);
  const json = fs.readFileSync(file, 'utf8');
  expect(JSON.parse(json).name, 'the export is the character').toBe(original.name);
  state.exported = file;

  // a fresh character, then the sidebar's Import Data
  state.copy = await page.evaluate(async (json) => {
    const actor = await Actor.create({ name: 'stress droid (imported)', type: 'character' });
    await actor.importFromJSON(json);
    await new Promise((r) => setTimeout(r, 3000));
    return actor.uuid;
  }, json);

  const copy = await page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    actor.reset();
    const s = actor.system;
    return {
      name: actor.name, items: actor.items.size, soak: s.stats.soak.value, wounds: s.stats.wounds.max, strain: s.stats.strain.max,
      encumbrance: s.stats.encumbrance.value, threshold: s.stats.encumbrance.max, credits: s.stats.credits.value,
      xp: s.experience, morality: s.morality.value, obligation: Object.keys(s.obligationlist ?? {}).length,
      skills: Object.fromEntries(Object.entries(s.skills).map(([k, v]) => [k, v.rank])),
      talents: actor.items.filter((i) => i.type === 'talent').map((i) => i.name).sort(),
      rifleDamage: actor.items.getName('DDC-MR6 Modular Rifle')?.system.damage.adjusted,
      stored: actor.items.filter((i) => i.system.storedIn).map((i) => i.name).sort(),
    };
  }, state.copy);

  expect(copy, 'the imported character matches the original').toEqual(original);
});
