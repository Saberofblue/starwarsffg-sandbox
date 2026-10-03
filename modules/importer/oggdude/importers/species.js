import ImportHelpers from "../../import-helpers.js";

export default class Species {
  static getMetaData() {
    return {
      displayName: 'Species',
      className: "Species",
      itemName: "species",
      localizationName: "TYPES.Item.species",
      fileNames: ["/Species/"],
      filesAreDir: true,
      phase: 4,
    };
  }

  static async Import(zip) {
    try {
      const files = Object.values(zip.files).filter((file) => {
        return !file.dir && file.name.split(".").pop() === "xml" && file.name.includes("/Species/");
      });
      let totalCount = files.length;
      let currentCount = 0;

      if (files.length) {
        let pack = await ImportHelpers.getCompendiumPack("Item", `oggdude.Species`);
        CONFIG.logger.debug(`Starting Oggdude Species Import`);
        $(".import-progress.species").toggleClass("import-hidden");

        await ImportHelpers.asyncForEach(files, async (file) => {
          try {
            const zipData = await zip.file(file.name).async("text");
            const xmlData = ImportHelpers.stringToXml(zipData);
            const speciesData = JXON.xmlToJs(xmlData);
            const item = speciesData.Species;

            item.Description = ImportHelpers.cleanDescription(item.Description);

            let data = ImportHelpers.prepareBaseObject(item, "species");

            data.data = {
              attributes: {},
              description: item.Description,
              talents: {},
              abilities: {},
              // structured "choose N skills" grants derived from OggDude StartingSkillTraining (see parseSkillTrainings)
              bonusSkills: [],
              startingXP: item.StartingAttrs.Experience ? parseInt(item.StartingAttrs.Experience, 10) : 0,
              metadata: {
                tags: [
                  "species",
                ],
                sources: ImportHelpers.getSourcesAsArray(item?.Sources ?? item?.Source),
              },
            };

            // natural weapons with a profile of their own (an Ithorian's bellow, a Selonian's tail)
            data.data.grantedWeapons = await ImportHelpers.weaponProfiles(item);

            // populate starting characteristics
            Object.keys(item.StartingChars).forEach((char) => {
              data.data.attributes[char] = {
                mod: char,
                modtype: "Characteristic",
                value: parseInt(item.StartingChars[char], 10),
                exclude: true,
              };
            });

            // populate starting stats
            Object.keys(item.StartingAttrs).forEach((attr) => {
              let mod;
              switch (attr) {
                case "WoundThreshold":
                case "StrainThreshold": {
                  mod = attr.replace("Threshold", "");
                  break;
                }
              }
              if (mod === "Wound") mod = "Wounds";

              if (mod) {
                data.data.attributes[mod] = {
                  mod,
                  modtype: "Stat",
                  value: item?.StartingAttrs?.[attr] ? parseInt(item.StartingAttrs[attr], 10) : 0,
                  exclude: true,
                };
              }
            });

            // populate species bonus skills
            if (item?.SkillModifiers?.SkillModifier) {
              if (!Array.isArray(item?.SkillModifiers?.SkillModifier)) {
                item.SkillModifiers.SkillModifier = [item.SkillModifiers.SkillModifier];
              }

              item.SkillModifiers.SkillModifier.forEach((skillMod) => {
                let skill = CONFIG.temporary.skills[skillMod.Key];
                if (skill) {
                  data.data.attributes[skill] = {
                    mod: skill,
                    modtype: "Skill Rank",
                    value: skillMod.RankStart ? parseInt(skillMod.RankStart, 10) : 0,
                    exclude: false,
                  };
                }
              });
            }

            // populate talents
            if (item?.TalentModifiers?.TalentModifier) {
              for (const talentData of Object.values(item.TalentModifiers)) {
                const talentKey = talentData.Key;
                let talent = await ImportHelpers.findCompendiumEntityByImportId("Item", talentKey, "world.oggdudetalents", "talent", true);
                if (!talent) {
                  continue;
                }
                data.data.talents[talent._id] = {
                  name: talent.name,
                  source: talent.uuid,
                  id: talent._id,
                }
              }
            }

            if (item?.OptionChoices?.OptionChoice) {
              if (!Array.isArray(item.OptionChoices.OptionChoice)) {
                item.OptionChoices.OptionChoice = [item.OptionChoices.OptionChoice];
              }

             // data.data.description += "<h4>Abilities</h4>";

              // populate abilities
              await ImportHelpers.asyncForEach(item.OptionChoices.OptionChoice, async (o) => {
                let option = o.Options.Option;
                if (!Array.isArray(o.Options.Option)) {
                  option = [o.Options.Option];
                }

                for (const curOption of option) {
                  data.data.abilities[foundry.utils.randomID()] = {
                    name: curOption.Name,
                    type: "ability",
                    system: {
                      description: curOption.Description,
                    },
                  };

                  // capture structured "choose N skills" grants (e.g. Human's 2 non-career skills) so the
                  // character creator can offer the choice instead of silently dropping it into ability text
                  if (curOption?.StartingSkillTraining) {
                    data.data.bonusSkills.push(...Species.parseSkillTrainings(curOption.StartingSkillTraining));
                  }
                }

                if (option[0].DieModifiers) {
                  const dieModifiers = await ImportHelpers.processDieMod(option[0].DieModifiers);
                  data.data.attributes = foundry.utils.mergeObject(data.data.attributes, dieModifiers.attributes);
                }

                //data.data.description += `<p>${option[0].Name} : ${option[0].Description}</p>`;
              });
            }

            // populate tags
            try {
              if (Array.isArray(item.Categories.Category)) {
                for (const tag of item.Categories.Category) {
                  data.data.metadata.tags.push(tag.toLowerCase());
                }
              } else {
                data.data.metadata.tags.push(item.Categories.Category.toLowerCase());
              }
            } catch (err) {
              CONFIG.logger.debug(`No categories found for item ${item.Key}`);
            }
            if (item?.Type) {
              // the "type" can be useful as a tag as well
              data.data.metadata.tags.push(item.Type.toLowerCase());
            }

            let imgPath = await ImportHelpers.getImageFilename(zip, "Species", "", data.flags.starwarsffg_sandbox.ffgimportid);
            if (imgPath) {
              data.img = await ImportHelpers.importImage(imgPath.name, zip, pack);
            }

            //data.data.description += ImportHelpers.getSources(item.Sources ?? item.Source);

            await ImportHelpers.addImportItemToCompendium("Item", data, pack);
            currentCount += 1;

            $(".species .import-progress-bar")
              .width(`${Math.trunc((currentCount / totalCount) * 100)}%`)
              .html(`<span>${Math.trunc((currentCount / totalCount) * 100)}%</span>`);
          } catch (err) {
            CONFIG.logger.error(`Error importing record : `, err);
          }
        });
      }
    } catch (err) {
      CONFIG.logger.error(`Error importing record : `, err);
    }
  }

  /**
   * Parse one or more OggDude <StartingSkillTraining> blocks into structured "choose N skills" grants.
   * OggDude models these as: StartingSkillTraining > SkillTraining[] > { SkillCount, Requirement }.
   * A single Option may carry several StartingSkillTraining siblings (e.g. Mandalorian Human), and a single
   * StartingSkillTraining may carry several SkillTraining entries (e.g. Droid), so both levels are normalised.
   * @param {object|object[]} startingSkillTraining - the JXON value of curOption.StartingSkillTraining
   * @returns {Array<{count:number, requirement:string, skillType?:string}>}
   */
  static parseSkillTrainings(startingSkillTraining) {
    const results = [];
    const blocks = Array.isArray(startingSkillTraining) ? startingSkillTraining : [startingSkillTraining];
    for (const block of blocks) {
      if (!block?.SkillTraining) continue;
      const trainings = Array.isArray(block.SkillTraining) ? block.SkillTraining : [block.SkillTraining];
      for (const training of trainings) {
        const count = training?.SkillCount ? parseInt(training.SkillCount, 10) : 0;
        if (!count) continue;
        const req = training?.Requirement ?? {};
        const entry = { count, requirement: "all" };
        if (req.NonCareer === "true") {
          entry.requirement = "nonCareer";
        } else if (req.Specialization === "true") {
          entry.requirement = "specialization";
        } else if (req.Career === "true") {
          entry.requirement = "career";
        } else if (req.FromSkillType === "true") {
          entry.requirement = "skillType";
          entry.skillType = Species.mapSkillType(req.SkillType);
        }
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Map an OggDude st-prefixed skill-type enum (stAll, stGeneral, stCombat, stSocial, stKnowledge, stMagic)
   * to the system's skill `type` value. "all" means no type restriction.
   * @param {string} raw
   * @returns {string}
   */
  static mapSkillType(raw) {
    if (!raw) return "all";
    const stripped = raw.replace(/^st/, "");
    return stripped.toLowerCase() === "all" ? "all" : stripped;
  }
}
