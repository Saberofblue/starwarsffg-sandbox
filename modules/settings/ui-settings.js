class ffgSettings extends FormApplication {
  activateListeners(html) {
    super.activateListeners(html);
    html.find("button.filepicker").click(this._onFilePicker.bind(this));
  }

  getData(acceptableSettings) {
    const canConfigure = game.user.can("SETTINGS_MODIFY");
    let includeSettings = [];
    for (const setting of game.settings.settings) {
      if (acceptableSettings.includes(setting[0])) {
        const s = foundry.utils.duplicate(setting[1]);
        s.name = game.i18n.localize(s.name);
        s.hint = game.i18n.localize(s.hint);
        s.value = game.settings.get(s.namespace, s.key);
        s.type = setting.type instanceof Function ? setting.type.name : "String";
        s.isCheckbox = setting[1].type === Boolean;
        s.isSelect = s.choices !== undefined;
        s.isRange = setting[1].type === Number && s.range;
        s.isFilePicker = setting.valueType === "FilePicker";
        includeSettings.push(s);
      }
    }

    const data = {
      system: {title: game.system.title, menus: [], settings: includeSettings},
    };

    // Return data
    return {
      user: game.user,
      canConfigure: canConfigure,
      systemTitle: game.system.title,
      data: data,
    };
  }

  _onFilePicker(event) {
    event.preventDefault();

    const fp = new foundry.applications.apps.FilePicker({
      type: "image",
      callback: (path) => {
        $(event.currentTarget).prev().val(path);
        //this._onSubmit(event);
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }

    /** @override */
  async _updateObject(event, formData) {
    for (let [k, v] of Object.entries(foundry.utils.flattenObject(formData))) {
      let s = game.settings.settings.get(k);
      let current = game.settings.get(s.namespace, s.key);
      if (v !== current) {
        await game.settings.set(s.namespace, s.key, v);
      }
    }
  }
}

export class rulesetSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ruleset-settings",
      classes: ["starwarsffg_sandbox", "ruleset-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.ruleset.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
        "starwarsffg_sandbox.dicetheme",
        "starwarsffg_sandbox.vehicleRangeBand",
        "starwarsffg_sandbox.skilltheme",
        "starwarsffg_sandbox.enableForceDie",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class uiSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ui-settings",
      classes: ["starwarsffg_sandbox", "ui-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.ui.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.ui-uitheme",
      "starwarsffg_sandbox.ui-pausedImage",
      "starwarsffg_sandbox.ui-token-healthy",
      "starwarsffg_sandbox.ui-token-wounded",
      "starwarsffg_sandbox.ui-token-overwounded",
      "starwarsffg_sandbox.ui-token-stamina-ok",
      "starwarsffg_sandbox.ui-token-stamina-damaged",
      "starwarsffg_sandbox.ui-token-stamina-over",
      "starwarsffg_sandbox.displaySimulation",
      "starwarsffg_sandbox.rollSimulation",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class combatSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "combat-settings",
      classes: ["starwarsffg_sandbox", "combat-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.combat.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.useGenericSlots",
      "starwarsffg_sandbox.initiativeRule",
      "starwarsffg_sandbox.removeCombatantAction",
      "starwarsffg_sandbox.useDefense",
      "starwarsffg_sandbox.additionalStatuses",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class actorSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "actor-settings",
      classes: ["starwarsffg_sandbox", "actor-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.actor.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.enableSoakCalc",
      "starwarsffg_sandbox.talentSorting",
      "starwarsffg_sandbox.showMinionCount",
      "starwarsffg_sandbox.showAdversaryCount",
      "starwarsffg_sandbox.adversaryItemName",
      "starwarsffg_sandbox.maxAttribute",
      "starwarsffg_sandbox.maxSkill",
      "starwarsffg_sandbox.medItemName",
      "starwarsffg_sandbox.HealingItemAction",
      "starwarsffg_sandbox.consumeHealingItem",
      "starwarsffg_sandbox.RivalTokenPrepend",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class xpSpendingSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "xpSpending",
      classes: ["starwarsffg_sandbox", "xpSpending"],
      title: `${game.i18n.localize("SWFFG.Settings.xpSpending.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.specializationCompendiums",
      "starwarsffg_sandbox.signatureAbilityCompendiums",
      "starwarsffg_sandbox.forcePowerCompendiums",
      "starwarsffg_sandbox.talentCompendiums",
      "starwarsffg_sandbox.backgroundCompendiums",
      "starwarsffg_sandbox.obligationCompendiums",
      "starwarsffg_sandbox.speciesCompendiums",
      "starwarsffg_sandbox.careerCompendiums",
      "starwarsffg_sandbox.motivationCompendiums",
      "starwarsffg_sandbox.itemCompendiums",
      "starwarsffg_sandbox.notifyOnXpSpend",
      "starwarsffg_sandbox.defaultObligation",
      "starwarsffg_sandbox.defaultDuty",
      "starwarsffg_sandbox.defaultMorality",
      "starwarsffg_sandbox.maxRarity",
      "starwarsffg_sandbox.allowRestricted",
      "starwarsffg_sandbox.defaultCredits",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class localizationSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "localization",
      classes: ["starwarsffg_sandbox", "localization"],
      title: `${game.i18n.localize("SWFFG.Settings.localization.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.skillSorting",
      "starwarsffg_sandbox.destiny-pool-light",
      "starwarsffg_sandbox.destiny-pool-dark",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class groupManagerSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "group-manager",
      classes: ["starwarsffg_sandbox", "group-manager"],
      title: `${game.i18n.localize("SWFFG.Settings.groupManager.Title")}`,
      template: "systems/starwarsffg_sandbox/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg_sandbox.pcListMode",
      "starwarsffg_sandbox.privateTriggers",
      "starwarsffg_sandbox.GMCharactersInGroupManager"
    ];
    return super.getData(includeSettingsNames);
  }
}
