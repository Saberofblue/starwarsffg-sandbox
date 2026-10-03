import { basic, core, grantedWeapons, hardpoints, itemattachments, qualities } from "./_templates.js";

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...core(),
      ...basic(),
      ...hardpoints(),
      ...itemattachments(),
      ...qualities(),
      ...grantedWeapons(),
    };
  }
}
