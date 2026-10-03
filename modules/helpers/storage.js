/**
 * Equipment that stores other equipment: holsters, weapon mounts and pouches.
 *
 * A storage slot is a modifier - a quality on the host, or an installed modification on one of
 * its attachments - carrying `system.storage`:
 *   { encLimit: number|null, types: string[], skills: string[], addlEnc: number }
 * Each rank of the modifier is one slot. An item stored in a carried host (`system.storedIn` =
 * the host's id) does not count toward the wearer's encumbrance.
 */
import { rankOf } from "./item-effects.js";

/**
 * The storage slots a host offers right now.
 * @returns {{name: string, encLimit: number|null, types: string[], skills: string[], count: number}[]}
 */
export function storageSlots(host) {
  const sys = host?.system ?? {};
  const slots = [];
  let addlEnc = 0;
  const consider = (modifier, enabled) => {
    const storage = modifier?.system?.storage;
    if (!storage || !enabled) return;
    const ranks = rankOf(modifier);
    if (storage.addlEnc) addlEnc += (Number(storage.addlEnc) || 0) * ranks;
    const hasLimit = storage.encLimit !== undefined && storage.encLimit !== null;
    if (!hasLimit && !storage.types?.length) return;
    slots.push({
      name: modifier.name,
      encLimit: hasLimit ? Number(storage.encLimit) : null,
      types: Array.isArray(storage.types) ? storage.types.map((t) => String(t).toLowerCase()) : [],
      skills: Array.isArray(storage.skills) ? storage.skills : [],
      count: ranks,
    });
  };
  for (const quality of sys.itemmodifier ?? []) consider(quality, true);
  for (const attachment of sys.itemattachment ?? []) {
    for (const modification of attachment?.system?.itemmodifier ?? []) consider(modification, !!modification?.system?.active);
  }
  // "Increase Allowable Weapon Encumbrance" raises every limit on the host
  for (const slot of slots) if (slot.encLimit !== null) slot.encLimit += addlEnc;
  return slots;
}

/** Whether one slot could hold an item. */
export function slotAccepts(slot, item) {
  if (slot.types.length && !slot.types.includes(String(item?.type ?? "").toLowerCase())) return false;
  if (slot.skills.length && !slot.skills.includes(item?.system?.skill?.adjusted || item?.system?.skill?.value)) return false;
  const stored = item?.system?.encumbrance ?? {};
  const encumbrance = parseInt(stored.adjusted ?? stored.value, 10) || 0;
  if (slot.encLimit !== null && encumbrance > slot.encLimit) return false;
  return true;
}

const idOf = (item) => item?.id ?? item?._id ?? item;

/**
 * Which of `items` a host can hold at once. Greedy in the order given, so an item listed first
 * keeps its place when a later one no longer fits.
 * @returns {Set<string>} ids of the items that fit
 */
export function assignStorage(host, items) {
  const slots = storageSlots(host).map((slot) => ({ ...slot, free: slot.count }));
  const fits = new Set();
  for (const item of items) {
    const slot = slots.find((s) => s.free > 0 && slotAccepts(s, item));
    if (!slot) continue;
    slot.free -= 1;
    fits.add(idOf(item));
  }
  return fits;
}

/** Whether `host` can take `item` on top of what it already holds. */
export function canStore(host, item, alreadyStored = []) {
  return assignStorage(host, [...alreadyStored, item]).has(idOf(item));
}

/** A host is holding things only while it is itself carried, and not inside something else. */
export function hostIsCarried(host) {
  return !!host && !host.system?.stowed && !host.system?.storedIn;
}

/**
 * The ids of every item on an actor that is stored away on a carried host, host by host.
 * @param {Item[]|Collection} items the actor's items
 * @returns {Set<string>}
 */
export function storedAwayIds(items) {
  const list = Array.from(items ?? []);
  const get = (id) => (typeof items?.get === "function" ? items.get(id) : list.find((i) => idOf(i) === id));
  const byHost = new Map();
  for (const item of list) {
    const hostId = item?.system?.storedIn;
    if (!hostId || hostId === idOf(item)) continue;
    if (!byHost.has(hostId)) byHost.set(hostId, []);
    byHost.get(hostId).push(item);
  }
  const stored = new Set();
  for (const [hostId, held] of byHost) {
    const host = get(hostId);
    if (!hostIsCarried(host)) continue;
    for (const id of assignStorage(host, held)) stored.add(id);
  }
  return stored;
}

/**
 * The hosts on an actor that could take an item right now, each with what it already holds.
 */
export function storageHostsFor(actor, item) {
  const items = Array.from(actor?.items ?? []);
  const hosts = [];
  for (const host of items) {
    if (idOf(host) === idOf(item) || !hostIsCarried(host)) continue;
    if (!storageSlots(host).length) continue;
    const held = items.filter((i) => i.system?.storedIn === idOf(host) && idOf(i) !== idOf(item));
    if (canStore(host, item, held)) hosts.push({ host, held });
  }
  return hosts;
}

/**
 * Ask where to store an item, and write the choice.
 */
export async function chooseStorage(actor, item) {
  const current = item.system?.storedIn ?? "";
  const hosts = storageHostsFor(actor, item);
  if (!hosts.length && !current) {
    ui.notifications.info(game.i18n.format("SWFFG.Items.Storage.NoHosts", { item: item.name }));
    return;
  }
  const options = [`<option value="" ${current ? "" : "selected"}>${game.i18n.localize("SWFFG.Items.Storage.None")}</option>`];
  for (const { host, held } of hosts) {
    const label = `${host.name} (${held.length}/${storageSlots(host).reduce((n, s) => n + s.count, 0)})`;
    options.push(`<option value="${host.id}" ${current === host.id ? "selected" : ""}>${label}</option>`);
  }
  const content = `
    <p>${game.i18n.localize("SWFFG.Items.Storage.Prompt")}</p>
    <div class="form-group">
      <label>${game.i18n.localize("SWFFG.Items.Storage.StoredIn")}</label>
      <div class="form-fields"><select name="host">${options.join("")}</select></div>
    </div>`;
  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format("SWFFG.Items.Storage.Title", { item: item.name }) },
    content,
    ok: { label: game.i18n.localize("SWFFG.ButtonAccept"), callback: (event, button) => button.form.elements.host.value },
    rejectClose: false,
  });
  if (choice === null || choice === undefined || choice === current) return;
  await item.update({ "system.storedIn": choice });
}
