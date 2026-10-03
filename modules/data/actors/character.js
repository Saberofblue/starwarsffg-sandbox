import { attributes, biography, career, characterStats, characteristics, general, metaOnly,
         motivation, skills, species, specialisation } from "./_templates.js";
import { keyedMap, numberStat } from "../fields.js";

const fields = foundry.data.fields;

export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...biography(),
      ...species(),
      ...career(),
      ...specialisation(),
      ...characterStats(),
      ...characteristics(),
      ...skills(),
      ...attributes(),
      ...general(),
      ...motivation(),
      ...metaOnly(),
      // not the real one (which is in characterStats)
      encumbrance: numberStat({ label: "Encumbrance", abrev: "Encum" }),
      obligation: numberStat({ label: "Obligation", adjusted: false }),
      duty: numberStat({ label: "Duty", adjusted: false }),
      morality: numberStat({ label: "Morality", adjusted: false }),
      conflict: numberStat({ label: "Conflict", adjusted: false }),
      // legacy, keyed by randomID, each {type, magnitude}. Obligations and duties are now
      // "obligation" items (the sheet's add control, the wizard and the importer make them);
      // the Group Manager reads both
      obligationlist: keyedMap(),
      dutylist: keyedMap(),
      experience: new fields.SchemaField({
        total: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
        available: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
      }),
    };
  }
}
