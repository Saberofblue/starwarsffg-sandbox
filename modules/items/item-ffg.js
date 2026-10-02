import ItemBaseFFG from "./itembase-ffg.js";
import PopoutEditor from "../popout-editor.js";
import ActorOptions from "../actors/actor-ffg-options.js";
import ImportHelpers from "../importer/import-helpers.js";
import ModifierHelpers from "../helpers/modifiers.js";
import Helpers from "../helpers/common.js";
import ItemHelpers from "../helpers/item-helpers.js";
import { activeEffectChangesUpdate, activeEffectCreateData, getActiveEffectChanges } from "../compatibility/active-effects.js";
import { CARRIER_TYPES, computeItemEffects, removeGrantedTalents, syncGrantedTalents, syncManagedEffects } from "../helpers/item-effects.js";

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class ItemFFG extends ItemBaseFFG {
  /** @override **/
  async _preCreate(data, operation, user) {
    const defaultImages = {
      armour: "systems/starwarsffg_sandbox/images/defaults/items/armor.png",
      itemattachment: "systems/starwarsffg_sandbox/images/defaults/items/attachment.png",
      gear: "systems/starwarsffg_sandbox/images/defaults/items/gear.png",
      itemmodifier: "systems/starwarsffg_sandbox/images/defaults/items/itemmodifier.png",
      weapon: "systems/starwarsffg_sandbox/images/defaults/items/weapon.png",
    }
    if (game.user.id === user.id && (!data?.img || data?.img === "icons/svg/mystery-man.svg")) {
      if (Object.keys(defaultImages).includes(data.type)) {
        this.updateSource({img: defaultImages[data.type]});
      } else {
        // fall back to the old default
        this.updateSource({img: "icons/svg/item-bag.svg"});
      }
    }
    return {data, operation, user};
  }

  /** @override */
  async _preUpdate(changes, options, user) {
    if (CARRIER_TYPES.includes(this.type) && changes?.system) {
      const stowed = changes.system.stowed;
      const equipped = changes.system.equippable?.equipped;
      if (stowed === true) {
        // a stowed item is packed away: not worn, and not in anything's holster
        if (this.system.equippable !== undefined) foundry.utils.setProperty(changes, "system.equippable.equipped", false);
        changes.system.storedIn = "";
      }
      if (equipped === true && this.system.stowed) changes.system.stowed = false;
    }
    return super._preUpdate(changes, options, user);
  }

  /** @override */
  async _onCreate(data, options, user) {
    if (user !== game.user.id) {
      // only run onCreate for the user actually performing the update
      return;
    }
    // on create, run the first-time setup for deep data
    if (this.type === 'forcepower') {
      await this.update(
          this._prepareForcePowers()
      );
    } else if (this.type === 'signatureability') {
      await this.update(
          this._prepareSignatureAbilities()
      );
    } else if (this.type === 'specialization') {
      await this.update(
          await this._prepareSpecializations()
      );
    }

    await super._onCreate(data, options, user);

    if (CARRIER_TYPES.includes(this.type)) {
      await syncManagedEffects(this);
      await syncGrantedTalents(this);
    } else {
      await this._onCreateAEs(options);
    }
  }

  /** @override */
  async _onDelete(options, userId) {
    await super._onDelete(options, userId);
    if (userId === game.user.id && CARRIER_TYPES.includes(this.type) && this.actor) {
      await removeGrantedTalents(this.actor, this.id);
    }
  }

  async _onCreateAEs(options, force=false) {
    if (CARRIER_TYPES.includes(this.type)) {
      // carriers keep their managed effects in step through the sync, whoever asks
      return syncManagedEffects(this, { force: true });
    }
    if (["species", "career", "specialization"].includes(this.type) && (!options.parent || force)) {
      const existingEffects = this.getEmbeddedCollection("ActiveEffect");
      // items are "created" when they are pulled from Compendiums, so don't duplicate Active Effects
      const inherentEffect = existingEffects.find(i => i.name === `(inherent)`);
      if (!inherentEffect) {
        // _onCreate is not awaited, so the importer's own call can land while this one is still
        // running; join it instead of creating a second effect
        if (this._inherentAECreation) {
          await this._inherentAECreation;
          return;
        }
        CONFIG.logger.debug(`Creating inherent Active Effect for item ${this.name}`);
        const effects = {
          name: `(inherent)`,
          img: this.img,
          changes: [],
        };
        if (this.type === "species") {
          for (const attribute of Object.keys(this.system.attributes)) {
            if (attribute.startsWith("attr")) {
              // migrated data may contain attributes that the user has added, and we don't want this in the inherent effect
              continue;
            }
            const explodedMods = ModifierHelpers.explodeMod(
              this.system.attributes[attribute].modtype,
              attribute
            );
            for (const cur_mod of explodedMods) {
              const path = ModifierHelpers.getModKeyPath(
                cur_mod['modType'],
                cur_mod['mod']
              );
              effects.changes.push({
                key: path,
                type: "add",
                value: this.system.attributes[attribute].value,
              });
            }
          }
        } else if (["career", "specialization"].includes(this.type)) {
          // ItemHelpers.itemUpdate fills these in on a sheet submit, but an item created through
          // the API - an import, or the PC wizard's compendium - never sees one, and was left with
          // eight placeholder changes that marked nothing (#2164)
          const slots = this.type === "career" ? 8 : 5;
          for (let i = 0; i < slots; i++) {
            const skill = this.system.careerSkills?.[`careerSkill${i}`];
            effects.changes.push({
              key: skill && skill !== "(none)" ? `system.skills.${skill}.careerskill` : "(none)",
              type: "add",
              value: true,
            });
          }
        }

        CONFIG.logger.debug(`Creating Active Effect for ${this.name}/${this.type} on item creation`);
        CONFIG.logger.debug(effects);
        this._inherentAECreation = this.createEmbeddedDocuments("ActiveEffect", [activeEffectCreateData(effects)]);
        await this._inherentAECreation;
        delete this._inherentAECreation;
      }
    }
  }

  /** @override */
  async _onUpdate(changed, options, userId) {
    CONFIG.logger.debug("Performing _onUpdate of item");
    await super._onUpdate(changed, options, userId);
    if (userId !== game.user.id) {
      // only run onCreate for the user actually performing the update
      return;
    }
    if (options.ffgSkipEffectSync) {
      // the OggDude importer rebuilds this item's effects itself right after the update; syncing
      // them here as well races that rebuild (updates landing on effects it has just deleted)
      return;
    }

    if (CARRIER_TYPES.includes(this.type)) {
      // a carrier's managed effects follow its data: equip state, qualities, attachments and
      // their installed modifications are all read back from the item itself
      if (changed.system) {
        await syncManagedEffects(this);
        await syncGrantedTalents(this);
      }
      return;
    }

    const existingEffects = this.getEmbeddedCollection("ActiveEffect");
    CONFIG.logger.debug(`On item ${this.name} update, found the following active effects:`);
    CONFIG.logger.debug(existingEffects);
    // update active effects from the item itself (e.g., stat boosts on species)
    const itemEffect = existingEffects.find(i => i.name === `(inherent)`);
    if (itemEffect) {
      CONFIG.logger.debug(`And located the following effects directly from this item: ${JSON.stringify(itemEffect)}`);
    } else {
      CONFIG.logger.debug("Unable to locate any inherent effect. This may be expected.");
    }
    if (itemEffect && Object.keys(changed).includes("system") && Object.keys(changed.system).includes("attributes")) {
      const newChanges = foundry.utils.deepClone(getActiveEffectChanges(itemEffect));
      for (const updateKey of Object.keys(changed.system.attributes)) {
        const existingChange = newChanges.find(c => c.key.startsWith(`system.attributes.${updateKey}`));
        if (existingChange) {
          existingChange.value = parseInt(changed.system.attributes[updateKey].value);
        }
      }
      await itemEffect.update(activeEffectChangesUpdate(newChanges));
    }

    // iterate over the changed data to look for any changes to attributes
    if (changed?.system?.attributes) {
      for (const attrKey of Object.keys(changed.system.attributes)) {
        const existingEffect = existingEffects.find(i => i.name === attrKey);
        const attr = this.system.attributes[attrKey];
        // Defensive: only explode mods if modtype and mod are defined
        let explodedMods = [];
        if (attr && typeof attr.modtype !== 'undefined' && typeof attr.mod !== 'undefined') {
          explodedMods = ModifierHelpers.explodeMod(attr.modtype, attr.mod);
        }

        const changes = [];
        for (const curMod of explodedMods) {
          changes.push({
            key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
            type: "add",
            value: attr?.value,
          });
        }

        if (existingEffect) {
          // existing entry
          CONFIG.logger.debug(`> Staged AE changes for update: ${JSON.stringify(changes)}`);
          await existingEffect.update({
            changes: changes,
          });
        }
      }
    }

  }

  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  async prepareData() {
    await super.prepareData();

    // Get the Item's data
    const item = this;
    const actor = this.actor ? this.actor : {};
    const data = item.system;

    if (!item.flags.starwarsffg_sandbox) {
      await item.updateSource({
        flags: {
          starwarsffg_sandbox: {
            isCompendium: !!this.compendium,
            ffgUuid: this.parent?.system ? this.uuid : null,
            ffgIsOwned: this.isEmbedded,
            loaded: false
          }
        }
      });
    } else {
      if (this.compendium) {
        item.flags.starwarsffg_sandbox.isCompendium = true;
        // Temporary check on this.parent.data to avoid initialisation failing in Foundry VTT 0.8.6
        if (this.uuid) item.flags.starwarsffg_sandbox.ffgUuid = this.uuid;
      } else {
        item.flags.starwarsffg_sandbox.isCompendium = false;
        item.flags.starwarsffg_sandbox.ffgIsOwned = false;
        if (this.isEmbedded) {
          item.flags.starwarsffg_sandbox.ffgIsOwned = true;
          // Temporary check on this.parent.data to avoid initialisation failing in Foundry VTT 0.8.6
          if (this.parent) item.flags.starwarsffg_sandbox.ffgUuid = this.uuid;
        } else if (item._id) {
          item.flags.starwarsffg_sandbox.ffgTempId = item._id;
        }
      }
    }

    data.renderedDesc = await PopoutEditor.renderDiceImages(data.description, actor);
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    const data = this.system;

    if (CARRIER_TYPES.includes(this.type)) {
      // every adjusted value comes from the one computation the managed effects and dice pools
      // also use; it runs here, synchronously, so the actor's own derived data can read it
      const bands = this.type === "shipweapon" ? CONFIG.FFG.vehicle_ranges : CONFIG.FFG.ranges;
      const computed = computeItemEffects(this, { rangeBands: Object.values(bands ?? {}) });
      for (const [key, stat] of Object.entries(computed.stats)) {
        const target = data[key];
        if (!target) continue;
        if (key === "range") {
          target.adjusted = stat.adjusted;
          target.sources = stat.sources;
          target.label = (this.type === "weapon" ? "SWFFG.WeaponRange" : "SWFFG.VehicleRange") + this._capitalize(stat.adjusted);
        } else {
          target.value = stat.base;
          target.adjusted = stat.adjusted;
          target.sources = stat.sources;
          if (key === "hardpoints") target.current = stat.current;
        }
      }
      data.adjusteditemmodifier = computed.adjusteditemmodifier;
      data.ffgState = computed.state;
    } else if (this.type === "talent") {
      const cleanedActivationName = data.activation.value.replace(/[\W_]+/g, "");
      data.activation.label = `SWFFG.TalentActivations${this._capitalize(cleanedActivationName)}`;
    }

    if (this.type === "forcepower") {
      this._prepareForcePowers();
    }

    if (this.type === "specialization") {
      this._prepareSpecializations();
    }

    if (this.type === "signatureability") {
      this._prepareSignatureAbilities();
    }
  }
  /**
   * Capitalize string
   * @param  {String} s   String value to capitalize
   */
  _capitalize(s) {
    if (typeof s !== "string") return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  _prepareTalentTrees(collection, itemType, listProperty, hasGlobalList) {
    const item = this;
    const talents = item.system[collection];
    let rowcount = 0;
    const controls = Object.keys(talents).filter((item) => {
      return item.includes(itemType);
    });

    let itemList = [];

    for (let upgrade of controls) {
      if (upgrade.includes(itemType)) {
        if (talents[upgrade].islearned) {
          const item = JSON.parse(JSON.stringify(talents[upgrade]));

          if (item.isRanked || listProperty === "powerUpgrades") {
            item.rank = 1;
          } else {
            item.rank = "N/A";
          }

          let index = itemList.findIndex((obj) => {
            return obj.name === item.name;
          });

          if (index < 0 || (!item.isRanked && listProperty !== "powerUpgrades")) {
            itemList.push(item);
          } else {
            itemList[index].rank += 1;
          }
        }

        if (itemType === "talent") {
          const id = parseInt(upgrade.replace("talent", ""), 10);
          talents[upgrade].cost = (Math.trunc(id / 4) + 1) * 5;
        }

        if (typeof talents[upgrade].visible === "undefined") {
          talents[upgrade].visible = true;
        }

        if (talents[upgrade].visible) {
          if (!talents[upgrade].size || talents[upgrade].size === "single") {
            talents[upgrade].size = "single";
            talents[upgrade].canSplit = false;
            rowcount += 1;
          } else if (talents[upgrade].size === "double") {
            rowcount += 2;
            talents[upgrade].canSplit = true;
          } else if (talents[upgrade].size === "triple") {
            rowcount += 3;
            talents[upgrade].canSplit = true;
          } else {
            rowcount += 4;
            talents[upgrade].canSplit = true;
          }
        }

        talents[upgrade].canCombine = false;
        talents[upgrade].canLinkTop = true;
        talents[upgrade].canLinkRight = true;

        if (rowcount === 4) {
          talents[upgrade].canLinkRight = false;
        }

        const controlNumber = parseInt(upgrade.replace(itemType, ""), 10);

        if (rowcount < 4) {
          talents[upgrade].canCombine = true;
        } else {
          rowcount = 0;
        }
      }
    }

    itemList.sort((a, b) => {
      return a.name - b.name;
    });

    item[listProperty] = itemList;
    return {system: {collection: talents}};
  }

  async _prepareSpecializations() {
    return this._prepareTalentTrees("talents", "talent", "talentList");
  }

  /**
   * Prepare Force Power Item Data
   */
  _prepareForcePowers() {
    return this._prepareTalentTrees("upgrades", "upgrade", "powerUpgrades");
  }

  _prepareSignatureAbilities() {
    return this._prepareTalentTrees("upgrades", "upgrade", "powerUpgrades");
  }

  _updateSpecializationTalentReference(specializationTalentItem, talentItem) {
    CONFIG.logger.debug(`Updating Specializations Talent ${specializationTalentItem.name} with ${talentItem.name}`);
    specializationTalentItem.name = talentItem.name;
    specializationTalentItem.description = talentItem.system.description;
    specializationTalentItem.activation = talentItem.system.activation.value;
    specializationTalentItem.activationLabel = talentItem.system.activation.label;
    specializationTalentItem.isRanked = talentItem.system.ranks.ranked;
    specializationTalentItem.isForceTalent = talentItem.system.isForceTalent;
    specializationTalentItem.isConflictTalent = talentItem.system.isConflictTalent;
    specializationTalentItem.attributes = talentItem.system.attributes;
  }

  /**
   * Prepare and return details of the item for display in inventory or chat.
   */
  async getItemDetails() {
    const data = foundry.utils.duplicate(this.system);

    // Item type specific properties
    const props = [];
    const purchasedUpgrades = [];
    const specializations = [];
    const signatureAbilities = [];

    data.prettyDesc = await PopoutEditor.renderDiceImages(data.description, this.actor);

    if (["weapon", "armor", "armour", "shipweapon"].includes(this.type)) {
      const sheetData = (await this.sheet.getData()).data;
      data.doNotSubmit = sheetData.doNotSubmit;
      data.enrichedSpecial = sheetData.enrichedSpecial;
    }

    if (["talent"].includes(this.type) && data.longDesc) {
      data.description = data.longDesc;
    }

    if (this.type === "weapon") {
      const ammoEnabled = this.getFlag("starwarsffg_sandbox", "config.enableAmmo");
      if (ammoEnabled) {
        props.push(`Ammo: ${data.ammo.value}/${data.ammo.max}`);
      }
    }

    if (this.type === "forcepower" || this.type === "signatureability") {
      //Display upgrades

      // Get learned upgrades
      const upgrades = Object.values(data.upgrades).filter((up) => up.islearned);

      const upgradeDescriptions = [];

      for (const up of upgrades) {
        let index = upgradeDescriptions.findIndex((obj) => {
          return obj.name === up.name;
        });

        if (index >= 0) {
          upgradeDescriptions[index].rank += 1;
        } else {
          upgradeDescriptions.push({
            name: up.name,
            description: await foundry.applications.ux.TextEditor.enrichHTML(up.description),
            rank: 1,
          });
        }
      }

      for (const upd of upgradeDescriptions) {
        props.push(`<div class="ffg-sendtochat hover" onclick="">${upd.name} ${upd.rank}
          <div class="tooltip2">
            ${upd.description}
          </div>
        </div>`);
        purchasedUpgrades.push({
          name: upd.name,
          rank: upd.rank,
          description: upd.description,
        })
      }
    }
    // General equipment properties
    else if (this.type !== "talent") {
      if (data.hasOwnProperty("doNotSubmit")) {
        const modifiers = data.doNotSubmit.qualities;
        const qualities = [];
        for (const modifier of modifiers) {
          qualities.push(`
          <div class='item-pill-hover hover-tooltip' data-item-type="itemmodifier" data-item-embed-name="${ modifier.name }" data-item-embed-img="${ modifier.img }" data-desc="${ (await foundry.applications.ux.TextEditor.enrichHTML(modifier.description)).replaceAll('"', "'") }" data-item-ranks="${ modifier.totalRanks }" data-tooltip="Loading...">
            ${modifier.name} ${modifier.totalRanks === null || modifier.totalRanks === 0 ? "" : modifier.totalRanks}
          </div>
          `);
        }

        props.push(`<div>${game.i18n.localize("SWFFG.ItemDescriptors")}: <ul>${qualities.join("")}<ul></div>`);
      }

      if (data.hasOwnProperty("encumbrance")) {
        props.push(`${game.i18n.localize("SWFFG.Encumbrance")}: ${data.encumbrance?.adjusted ? data.encumbrance.adjusted : data.encumbrance.value}`);
      }
      if (data.hasOwnProperty("price")) {
        props.push(`${game.i18n.localize("SWFFG.ItemsPrice")}: ${data.price?.adjusted ? data.price.adjusted : data.price.value}`);
      }
      if (data.hasOwnProperty("rarity")) {
        props.push(`${game.i18n.localize("SWFFG.ItemsRarity")}: ${data.rarity?.adjusted ? data.rarity.adjusted : data.rarity.value} ${data.rarity.isrestricted ? "<span class='restricted'>" + game.i18n.localize("SWFFG.IsRestricted") + "</span>" : ""}`);
      }
      if (data.hasOwnProperty("talents")) {
        for (const talentKey of Object.keys(data.talents)) {
          const talent = data.talents[talentKey];
          if (talent?.islearned) {
            purchasedUpgrades.push({
              name: talent.name,
              rank: 0,
              description: talent.enrichedDescription,
            });
          }
        }
      }
      if (data.hasOwnProperty("specializations")) {
        for (const specializationKey of Object.keys(data.specializations)) {
          const specialization = data.specializations[specializationKey];
          const fullSpecialization = fromUuidSync(specialization.source);
          specializations.push({
            name: specialization.name,
            uuid: specialization.uuid,
            description: fullSpecialization?.system?.description,
            img: fullSpecialization?.img,
          });
        }
      }
      if (data.hasOwnProperty("signatureabilities")) {
        for (const SAKey of Object.keys(data.signatureabilities)) {
          const signatureAbility = data.signatureabilities[SAKey];
          const fullSignatureAbility = fromUuidSync(signatureAbility.source);
          signatureAbilities.push({
            name: signatureAbility.name,
            uuid: signatureAbility.uuid,
            description: fullSignatureAbility?.system?.description,
            img: fullSignatureAbility?.img,
          });
        }
      }
    }

    // Weapon properties
    if (this.type === "weapon") {
      if (data.hasOwnProperty("skill")) {
        const cleanedSkillName = data.skill.value.replace(/[\W_]+/g, "");
        const skillLabel = "SWFFG.SkillsName" + cleanedSkillName;
        props.push(`Skill: ${game.i18n.localize(skillLabel)}`);
      }
    }

    // Talent properties
    if (data.hasOwnProperty("isForceTalent")) {
      if (data.isForceTalent) props.push(game.i18n.localize("SWFFG.ForceTalent"));
    }
    if (data.hasOwnProperty("ranks")) {
      if (data.ranks.ranked) props.push(game.i18n.localize("SWFFG.Ranked"));
    }

    // Filter properties and return
    data.properties = props.filter((p) => !!p);
    data.textProperties = purchasedUpgrades;
    data.specializations = specializations;
    data.signatureAbilities = signatureAbilities;
    return data;
  }
}
