import { core, grantedWeapons } from "./_templates.js";
import { keyedMap } from "../fields.js";

const fields = foundry.data.fields;

export class SpeciesData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...core(),
      ...grantedWeapons(),
      talents: keyedMap(),
      abilities: keyedMap(),
      species: keyedMap(),
      // "choose N skills" grants parsed from OggDude StartingSkillTraining (Human's two non-career skills, etc.)
      bonusSkills: new fields.ArrayField(new fields.SchemaField({
        count: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
        requirement: new fields.StringField({ required: true, blank: false, initial: "all" }),
        skillType: new fields.StringField({ required: false, blank: true }),
      })),
      startingXP: new fields.NumberField({ required: true, nullable: false, initial: 0 }),
    };
  }
}
