import { basic, core, equippable, grantedWeapons, hardpoints, itemattachments, qualities } from "./_templates.js";
import { numberStat } from "../fields.js";

export class ArmourData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...core(),
      ...basic(),
      ...hardpoints(),
      ...equippable(),
      ...itemattachments(),
      ...qualities(),
      ...grantedWeapons(),
      defence: numberStat({ label: "Defence", abrev: "Def" }),
      soak: numberStat({ label: "Soak" }),
    };
  }
}
