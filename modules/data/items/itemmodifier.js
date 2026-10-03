import { core, qualities } from "./_templates.js";

const fields = foundry.data.fields;

export class ItemModifierData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...core(),
      ...qualities(),
      type: new fields.StringField({ required: true, initial: "all" }),
      rank: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      // ranks contributed by every source of this quality, summed while preparing the parent item
      rank_current: new fields.NumberField({ required: true, nullable: true, initial: 0 }),
      active: new fields.BooleanField({ required: true, initial: false }),
      // holsters, mounts and pouches: { encLimit, addlEnc, types, skills } (see helpers/storage.js)
      storage: new fields.ObjectField({ required: false, nullable: true, initial: undefined }),
      // which of the host's granted weapons this mod belongs to (OggDude WeaponModifierIndex): a
      // stun blaster's damage mod changes the stun blaster, not the hilt it is attached to
      weaponIndex: new fields.NumberField({ required: false, nullable: true, integer: true, initial: undefined }),
    };
  }
}
