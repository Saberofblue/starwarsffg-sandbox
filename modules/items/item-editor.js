import ItemHelpers from "../helpers/item-helpers.js";
import ModifierHelpers from "../helpers/modifiers.js";

export class itemEditor extends FormApplication  {
  /*
  Known issues:
    - The title of the editor doesn't get updated when you update the name
    - Modification descriptions are rendered in an input field, not a rich text editor. I can't figure out how to get them to work in RTEs
    - Qualities added from an attachment do not get totaled if they are also already present on the weapon (e.g. a weapon with Pierce 2 and an attachment which adds Pierce 1)
  */
  constructor(data) {
    super();
    this.data = data;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        title: `Embedded Item Editor`, // should not be seen by anyone, as it is dynamically set on getData()
        //height: 720,
        width: 520,
        template: "systems/starwarsffg_sandbox/templates/items/dialogs/ffg-embedded-itemattachment.html",
        closeOnSubmit: false,
        submitOnClose: true,
        submitOnChange: true,
        resizable: true,
        classes: ["starwarsffg_sandbox", "flat_editor", "sheet"],
        tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "tab1"}],
        scrollY: [".modification_container"],
      }
    );
  }

  /** @override */
  get template() {
    const path = "systems/starwarsffg_sandbox/templates/items/dialogs";
    return `${path}/ffg-embedded-${this.data.clickedObject.type}.html`;
  }

  /** @override */
  async getData(options) {
    // update the title since it isn't available when creating the application
    this.options.title = game.i18n.format("SWFFG.Items.Popout.Title", {currentItem: this.data.clickedObject.name, parentItem: this.data.sourceObject.name});
    const data = await this._enrichData();
    if (this.data.clickedObject.type === "itemattachment") {
      data.hardpoints = this._hardpointBudget();
      for (const modification of data.clickedObject.system.itemmodifier ?? []) {
        modification.isBaseMod = !!modification.flags?.starwarsffg?.baseMod;
        modification.hint = itemEditor.describeModification(modification, data.clickedObject);
      }
      data.clickedObject.hint = itemEditor.describeModification({ system: { attributes: data.clickedObject.system.attributes } });
    }
    let modifierChoices = CONFIG.FFG.allowableModifierChoices;

    // add in custom skills from the actor, if present
    if (this.data.sourceObject?.actor?.system?.skills) {
      const updatedChoices = foundry.utils.deepClone(modifierChoices);
      for (const modifierChoice of Object.keys(modifierChoices).filter(i => i.indexOf("Skill") >= 0)) {
        updatedChoices[modifierChoice] = this.data.sourceObject?.actor?.system?.skills;
      }
      modifierChoices = updatedChoices;
    }

    return {
      modifierTypes: CONFIG.FFG.allowableModifierTypes,
      modifierChoices: modifierChoices,
      data: data,
    };
  }

  /**
   * The carrier's hard points: its budget, what every attachment on it spends, and what this one costs.
   */
  _hardpointBudget() {
    const carrier = this.data.sourceObject;
    const hp = carrier.system?.hardpoints ?? {};
    const budget = parseInt(hp.adjusted ?? hp.value, 10) || 0;
    const used = (carrier.system?.itemattachment ?? []).reduce((sum, a) => sum + (parseInt(a?.system?.hardpoints?.value, 10) || 0), 0);
    const cost = parseInt(this.data.clickedObject.system?.hardpoints?.value, 10) || 0;
    return { budget, used, cost, free: budget - used, over: budget - used < 0 };
  }

  /**
   * What a modification does, in words, from its attributes, storage and grants.
   * @param {object} modification
   * @param {object} [host] the attachment or item carrying it, for a mod aimed at a weapon it grants
   * @returns {string}
   */
  static describeModification(modification, host = null) {
    const parts = [];
    const weaponIndex = modification?.system?.weaponIndex;
    const target = Number.isInteger(weaponIndex) ? host?.system?.grantedWeapons?.[weaponIndex] : null;
    if (target?.name) parts.push(game.i18n.format("SWFFG.Items.Popout.Hint.ForWeapon", { name: target.name }));
    const ranked = (parseInt(modification?.system?.rank, 10) || 1) > 1 || modification?.system?.maxRank > 1;
    for (const attr of Object.values(modification?.system?.attributes ?? {})) {
      if (!attr || typeof attr !== "object") continue;
      const modtype = String(attr.modtype ?? "");
      const mod = String(attr.mod ?? "");
      const choice = CONFIG.FFG.allowableModifierChoices?.[modtype]?.[mod];
      const label = game.i18n.localize(choice?.label ?? mod);
      const typeLabel = game.i18n.localize(CONFIG.FFG.allowableModifierTypes?.[modtype]?.label ?? modtype);
      if (mod.endsWith("-set")) {
        parts.push(game.i18n.format("SWFFG.Items.Popout.Hint.SetTo", { label, value: attr.value }));
      } else if (modtype === "Career Skill") {
        parts.push(`${typeLabel}: ${label}`);
      } else if (modtype === "Skill Characteristic") {
        parts.push(`${label}: ${game.i18n.localize(CONFIG.FFG.allowableModifierChoices?.Characteristic?.[attr.value]?.label ?? attr.value)}`);
      } else {
        const value = Number(attr.value);
        const amount = Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value}` : String(attr.value);
        const scope = modtype.startsWith("Skill") ? `${label} (${typeLabel})` : label;
        parts.push(`${amount} ${scope}${ranked ? ` ${game.i18n.localize("SWFFG.Items.Popout.Hint.PerRank")}` : ""}`);
      }
    }
    const storage = modification?.system?.storage;
    if (storage && (storage.encLimit !== undefined || storage.types?.length)) {
      const limits = [];
      if (storage.encLimit !== undefined && storage.encLimit !== null) limits.push(`${game.i18n.localize("SWFFG.ItemsEncum")} <= ${storage.encLimit}`);
      if (storage.types?.length) limits.push(storage.types.join("/"));
      if (storage.skills?.length) limits.push(storage.skills.join("/"));
      parts.push(game.i18n.format("SWFFG.Items.Popout.Hint.Storage", { count: parseInt(modification.system.rank, 10) || 1, limits: limits.length ? ` (${limits.join(", ")})` : "" }));
    }
    const grants = modification?.system?.grants;
    if (grants?.type === "talent") parts.push(game.i18n.format("SWFFG.Items.Popout.Hint.Grants", { name: grants.name ?? grants.key }));
    return parts.join("; ");
  }

  /**
   * retrieves data and converts rich text editor fields into the enriched version. this results in things like dice displaying
   * @returns {Promise<*>}
   * @private
   */
  async _enrichData() {
    let enriched = this.data;
    enriched.clickedObject.system.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(this.data.clickedObject.system.description);
    for (let modification of enriched.clickedObject.system.itemmodifier) {
      modification.system.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(modification.system.description);
    }
    return enriched;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html.find('[name="system.type"]').on("change", this._updateType.bind(this));
    html.find(".flat_editor.dropdown").on("change", this._updateDropdown.bind(this));
    html.find(".flat_editor.add-mod").on("click", this._modControl.bind(this));
    html.find(".flat_editor.add-modification").on("click", this._modificationControl.bind(this));

    // allow drag-and-dropping mods if this is an attachment
    if (this.data.clickedObject.type === "itemattachment") {
      const dragDrop = new foundry.applications.ux.DragDrop({
        dragSelector: ".item",
        dropSelector: ".starwarsffg_sandbox.flat_editor",
        permissions: { dragstart: this._canDragStart.bind(this), drop: this._canDragDrop.bind(this) },
        callbacks: { drop: this.onDropMod.bind(this) },
      });
      dragDrop.bind($(`[data-appid="${this.appId}"]`)[0]);
    }
  }

  async onDropMod(event) {
    CONFIG.logger.debug("caught mod drag-and-drop");
    if (this.data.clickedObject.type !== "itemattachment") {
      ui.notifications.info("You can only drag-and-drop mods onto attachments.");
      return;
    }

    let data;
    const specialization = this.object;
    const li = event.currentTarget;
    const talentId = $(li).attr("id");

    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (data.type !== "Item") return;
    } catch (err) {
      return false;
    }

    const droppedObject = await fromUuid(data.uuid);

    // if it's an attachment, locate the attachment to update
    let updateData;
    if (this.data.clickedObject.type === "itemattachment") {
      updateData = this.data.sourceObject.system.itemattachment;
      for (let attachment of updateData) {
        if (attachment._id === this.data.clickedObject._id) {
          // update the local object so we can see the update in the editor
          this.data.clickedObject.system.itemmodifier.push(droppedObject.toObject());
        }
      }
      await this.data.sourceObject.update({system: {itemattachment: updateData}});
      this.render(true);
    }
  }

  /**
   * Controls creating, deleting, or modifying mods (which contain modifiers)
   * @param event
   */
  async _modControl(event) {
    let action = event.currentTarget.getAttribute('data-action');
    if (action === 'create') {
      const nk = new Date().getTime();
      const modifierTypes = CONFIG.FFG.allowableModifierTypes;
      const modifierChoices = CONFIG.FFG.allowableModifierChoices;
      const modificationId = $(event.currentTarget).data("modification-id");
      let direct = this.data.clickedObject.type !== "itemattachment";
      if (modificationId === undefined) {
        // we aren't adding it to a modification, so this is true
        direct = true;
      }

      CONFIG.logger.debug(`caught creating a new mod on an attachment. data: ${modificationId}, ${direct}`);
      CONFIG.logger.debug(modifierTypes);
      CONFIG.logger.debug(modifierChoices);
      CONFIG.logger.debug(`expected new modtype is ${Object.keys(modifierTypes)[0]}`);
      CONFIG.logger.debug(`expected new mod mod is ${modifierChoices[Object.keys(modifierTypes)[0]]}`);

      let rendered = await foundry.applications.handlebars.renderTemplate(
        'systems/starwarsffg_sandbox/templates/items/dialogs/ffg-mod.html',
        {
          modifierTypes: modifierTypes,
          modifierChoices: modifierChoices,
          direct: direct,
          number: modificationId,
          attachmentType: this.data.clickedObject.system.type,
          id: `attr${nk}`,
          attr: {
            modtype: Object.keys(CONFIG.FFG.allowableModifierTypes)[0],
            mod: Object.keys(CONFIG.FFG.allowableModifierChoices[Object.keys(CONFIG.FFG.allowableModifierTypes)[0]])[0],
            value: 1,
          },
        }
      );

      $(event.currentTarget).parent().parent().children(".attributes-list").append(rendered);
      // update the listeners, so we catch events on these new entries
      this.activateListeners($(event.currentTarget).parent().parent().children(".attributes-list"));
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    } else if (action === 'delete') {
      $(event.currentTarget).parent().remove();
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    }
  }

  /**
   * Controls creating, deleting, or modifying modifications (which go on attachments)
   * @param event
   */
  async _modificationControl(event) {
    if(this.actor && !this.data.sourceObject.parent?.verifyEditModeIsNotEnabled()) return;

    let action = event.currentTarget.getAttribute('data-action');
    if (action === 'create') {
      const modTypeChoices = CONFIG.FFG.allowableModifierTypes;
      const modChoices = CONFIG.FFG.allowableModifierChoices;
      let rendered = await foundry.applications.handlebars.renderTemplate(
        'systems/starwarsffg_sandbox/templates/items/dialogs/ffg-modification.html',
        {
          modTypeChoices: modTypeChoices,
          modChoices: modChoices,
          direct: true,
          mod: {
            name: "New Modification",
            system: {
              description: "Placeholder description",
              active: false,
              rank: 0,
              attribute: {},
            },
          },
        }
      );
      $(event.currentTarget).parent().children('.modification_container').append(rendered);
      // update the listeners, so we catch events on these new entries
      this.activateListeners($(event.currentTarget).parent().children('.modification_container'));
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    } else if (action === 'delete') {
      $(event.currentTarget).parent().parent().remove();
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    }
  }

  /**
   * When an attachment or mod type is changed, update the dropdown choices
   * @param event
   * @returns {Promise<void>}
   */
  async _updateType(event) {
    // update our local record of which "attachmentType" we're on so dropdowns render correctly
    this.data.clickedObject.system.type = event.currentTarget.value;
    // iterate over mods and update the modifier to be the first choice of the first modifierType
    // this is done because the selected modifier type changes when the "attachmentType" is changed
    for (let mod of Object.keys(this.data.clickedObject.system.attributes)) {
      this.data.clickedObject.system.attributes[mod].modtype = Object.values(CONFIG.FFG.allowableModifierTypes[event.currentTarget.value])[0].value;
      this.data.clickedObject.system.attributes[mod].mod = Object.values(CONFIG.FFG.allowableModifierTypes[Object.values(CONFIG.FFG.allowableModifierTypes[event.currentTarget.value])[0].value])[0].value;
    }

    // if the item is an attachment, we also need to update mods on modifications
    if (this.data.clickedObject.type === "itemattachment") {
      for (let modifier of Object.keys(this.data.clickedObject.system.itemmodifier)) {
        // modifiers sometimes don't have the attributes in them...
        if (Object.keys(this.data.clickedObject.system.itemmodifier[modifier].system).includes("attributes")) {
          for (let mod of Object.keys(this.data.clickedObject.system.itemmodifier[modifier].system.attributes)) {
            this.data.clickedObject.system.itemmodifier[modifier].system.attributes[mod].modtype = Object.values(CONFIG.FFG.allowableModifierTypes[event.currentTarget.value])[0].value;
            this.data.clickedObject.system.itemmodifier[modifier].system.attributes[mod].mod = Object.values(CONFIG.FFG.allowableModifierTypes[Object.values(CONFIG.FFG.allowableModifierTypes[event.currentTarget.value])[0].value])[0].value;
          }
        }
      }
    }

    // re-render the form so we see the updated dropdown selections/options
    this.render(true);
  }

  /**
   * Updates the modifier 2nd level selector when the 1st level is updated
   * @param event "change" event
   */
  async _updateDropdown(event) {
    // TODO: I think the handlebars select helper can be used here, basically to remove most of this function
    let new_value = event.currentTarget.value;
    let dropdown = event.currentTarget.getAttribute('data-type');

    if (dropdown === 'modtype') {
      let new_html = '';
      let chosen_config = CONFIG.FFG.allowableModifierChoices[new_value];
      Object.keys(chosen_config).forEach(function (choice) {
        new_html += `<option value="${chosen_config[choice]['value']}">${game.i18n.localize(chosen_config[choice]['label'])}</option>`
      });
      $(event.currentTarget).parent().find(".flat_editor.dropdown.mod").html(new_html);

      // swap the value input between checkbox and number based on modtype
      const valueName = event.currentTarget.name.replace(/\.modtype$/, '.value');
      const $valueInput = $(event.currentTarget).parent().find(".modvalue");
      if (new_value === "Career Skill") {
        $valueInput.replaceWith(`<input name="${valueName}" type="checkbox" class="modvalue" data-attr-id="${$valueInput.data('attr-id')}">`);
      } else if (new_value === "Skill Characteristic") {
        const options = Object.values(CONFIG.FFG.allowableModifierChoices.Characteristic ?? {})
          .map((c) => `<option value="${c.value}">${game.i18n.localize(c.label)}</option>`).join("");
        $valueInput.replaceWith(`<select name="${valueName}" class="modvalue" data-attr-id="${$valueInput.data('attr-id')}">${options}</select>`);
      } else if ($valueInput.attr('type') === 'checkbox' || $valueInput.is('select')) {
        $valueInput.replaceWith(`<input name="${valueName}" type="number" class="modvalue" value="0" data-attr-id="${$valueInput.data('attr-id')}">`);
      }
    } else if (dropdown === 'mod') {
      // a change of skill or a range cap takes its value from a list, every other weapon stat a number
      const valueName = event.currentTarget.name.replace(/\.mod$/, '.value');
      const $valueInput = $(event.currentTarget).parent().find(".modvalue");
      const listFor = { "skill-set": "Skill Rank", "range-set": "Range Band" }[new_value];
      if (listFor) {
        const options = Object.values(CONFIG.FFG.allowableModifierChoices[listFor] ?? {})
          .map((c) => `<option value="${c.value}">${game.i18n.localize(c.label)}</option>`).join("");
        $valueInput.replaceWith(`<select name="${valueName}" class="modvalue" data-attr-id="${$valueInput.data('attr-id')}">${options}</select>`);
      } else if ($valueInput.is('select') && $(event.currentTarget).parent().find(".flat_editor.dropdown.modtype").val() !== "Skill Characteristic") {
        $valueInput.replaceWith(`<input name="${valueName}" type="number" class="modvalue" value="0" data-attr-id="${$valueInput.data('attr-id')}">`);
      }
    }
  }

  /** @override */
  async _updateObject(event, formData) {
    // which stored modification each form row came from: rows keep their original index after a
    // sibling is deleted, and a row added this session has none
    const rowIndices = [];
    for (const key of Object.keys(formData)) {
      const match = key.match(/^system\.itemmodifier\[(\d*)\]/);
      if (!match) continue;
      const index = match[1] === "" ? null : parseInt(match[1], 10);
      if (!rowIndices.some((i) => i === index)) rowIndices.push(index);
    }
    formData = ItemHelpers.explodeFormData(formData);
    // removing every row removes the field from the form entirely; put the empty containers back
    if (!Object.keys(formData.system).includes("itemmodifier")) formData.system.itemmodifier = [];
    if (!Object.keys(formData.system).includes("attributes")) formData.system.attributes = {};

    const type = this.data.clickedObject.type;
    if (!["itemattachment", "itemmodifier"].includes(type)) return;
    const list = foundry.utils.deepClone(this.data.sourceObject.system[type] ?? []);
    // qualities carry no ids of their own on a carrier, so they are matched by name
    const index = list.findIndex((entry) => type === "itemattachment"
      ? entry._id === this.data.clickedObject._id
      : entry.name === this.data.clickedObject.name);
    if (index < 0) return;
    const stored = list[index];

    // the form carries every surviving mod row, so a stored key it does not mention was deleted.
    // These are plain objects inside an array, where Foundry's "-=key" markers mean nothing.
    const surviving = (attributes) => Object.fromEntries(
      Object.entries(attributes ?? {}).filter(([key]) => !key.startsWith("-=")));
    const updated = foundry.utils.mergeObject(stored, formData, { inplace: false });
    updated.system.attributes = surviving(formData.system.attributes);

    if (type === "itemattachment") {
      // each modification row is merged over its stored twin so ids, images and flags survive
      updated.system.itemmodifier = formData.system.itemmodifier.map((row, i) => {
        const storedIndex = rowIndices[i];
        const base = (storedIndex === null || storedIndex === undefined)
          ? { type: "itemmodifier", system: { type: "all", active: false, rank: 0, attributes: {} } }
          : stored.system?.itemmodifier?.[storedIndex] ?? { type: "itemmodifier", system: {} };
        const merged = foundry.utils.mergeObject(base, row, { inplace: false });
        merged.system.attributes = surviving(row.system?.attributes);
        // a base mod has no Installed box on the form, and stays installed
        if (base.flags?.starwarsffg_sandbox?.baseMod) merged.system.active = true;
        const cap = parseInt(merged.system.maxRank, 10);
        if (cap > 0 && (parseInt(merged.system.rank, 10) || 0) > cap) merged.system.rank = cap;
        return merged;
      });
    }
    list[index] = updated;
    this.data.clickedObject = updated;
    // the carrier's update brings its managed effects in line with the new data
    await this.data.sourceObject.update({ system: { [type]: list } });
    // needed to re-render the mod form (as the input can change types based on the selected modType)
    this.render(true)
  }
}

export class talentEditor extends itemEditor {
  /*
    Known issues:
    - The description rich text editor doesn't appear to work
  */
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        title: `Embedded Talent Editor`, // should not be seen by anyone, as it is dynamically set on getData()
        //height: 720,
        width: 520,
        closeOnSubmit: false,
        submitOnClose: true,
        submitOnChange: true,
        resizable: true,
        classes: ["starwarsffg_sandbox", "flat_editor"],
        tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "tab1"}],
        scrollY: [".modification_container"],
      }
    );
  }

  /** @override */
  get template() {
    const path = "systems/starwarsffg_sandbox/templates/items/dialogs";
    return `${path}/ffg-embedded-talent.html`;
  }

    /** @override */
  async getData(options) {
    // update the title since it isn't available when creating the application
    this.options.title = game.i18n.format("SWFFG.Items.Popout.Title", {currentItem: this.data.clickedObject.name, parentItem: this.data.sourceObject.name});

    let activations = CONFIG.FFG.activations;
    let data = await this._enrichData();

    // add in custom skills from the actor, if present
    if (this.data.sourceObject?.actor?.system?.skills) {
      const updatedChoices = foundry.utils.deepClone(data.modifierChoices);
      for (const modifierChoice of Object.keys(CONFIG.FFG.allowableModifierChoices).filter(i => i.indexOf("Skill") >= 0)) {
        updatedChoices[modifierChoice] = this.data.sourceObject?.actor?.system?.skills;
      }
      data.modifierChoices = updatedChoices;
    }

    return {
      activations: activations,
      data: data,
    };
  }

  /**
   * Controls creating, deleting, or modifying mods (which contain modifiers)
   * @param event
   */
  async _modControl(event) {
    if(this.actor && !this.data.sourceObject.parent?.verifyEditModeIsNotEnabled()) return;

    let action = event.currentTarget.getAttribute('data-action');
    if (action === 'create') {
      const nk = new Date().getTime();
      const modifierTypes = CONFIG.FFG.allowableModifierTypes;
      const modifierChoices = CONFIG.FFG.allowableModifierChoices;
      const modificationId = $(event.currentTarget).data("modification-id");
      const direct = this.data.clickedObject.type !== "itemattachment";

      CONFIG.logger.debug(`caught creating a new mod on a talent. data: ${modificationId}, ${direct}`);
      CONFIG.logger.debug(modifierTypes);
      CONFIG.logger.debug(modifierChoices);
      CONFIG.logger.debug(`expected new modtype is ${Object.keys(modifierTypes)[0]}`);
      CONFIG.logger.debug(`expected new mod mod is ${modifierChoices[Object.keys(modifierTypes)[0]]}`);

      let rendered = await foundry.applications.handlebars.renderTemplate(
        'systems/starwarsffg_sandbox/templates/items/dialogs/ffg-mod.html',
        { // TODO: this should probably be a new item of the correct type so it assumes any changes to the data model automatically
          modifierTypes: modifierTypes,
          modifierChoices: modifierChoices,
          direct: direct,
          number: modificationId,
          attachmentType: 'all',
          id: `attr${nk}`,
          attr: {
            modtype: Object.keys(CONFIG.FFG.allowableModifierTypes)[0],
            mod: Object.keys(CONFIG.FFG.allowableModifierChoices[Object.keys(CONFIG.FFG.allowableModifierTypes)[0]])[0],
            value: 1,
          },
        }
      );

      $(event.currentTarget).parent().parent().children(".attributes-list").append(rendered);
      // update the listeners, so we catch events on these new entries
      this.activateListeners($(event.currentTarget).parent().parent().children(".attributes-list"));
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    } else if (action === 'delete') {
      $(event.currentTarget).parent().remove();
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    }
  }

  /**
   * retrieves data and converts rich text editor fields into the enriched version. this results in things like dice displaying
   * @returns {Promise<*>}
   * @private
   */
  async _enrichData() {
    let enriched = this.data;
    enriched.clickedObject.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(this.data.clickedObject.description);
    return enriched;
  }

  /** @override */
  async _updateObject(event, formData) {
    if(this.actor && !this.data.sourceObject.parent?.verifyEditModeIsNotEnabled()) return;

    CONFIG.logger.debug("Updating talent");
    formData = foundry.utils.expandObject(formData);

    // update the activation label to match the activation
    formData.activationLabel = CONFIG.FFG.activations[formData.activation].label;

    // move attributes out of "system" since they aren't here for talents
    formData.attributes = formData.system?.attributes;
    delete formData.system?.attributes;
    // make sure attributes is a dictionary instead of whatever they end up being
    if (!Object.keys(formData).includes("attributes") || formData.attributes === undefined) {
      formData.attributes = {};
    }

    const existingActiveEffects = this.data.sourceObject.getEmbeddedCollection("ActiveEffect");

    // iterate over attributes on the specialization and remove any that aren't present in the form
    if (Object.keys(this.data.sourceObject.system.talents[this.data.talentId]).includes("attributes") && this.data.sourceObject.system.talents[this.data.talentId].attributes !== undefined) {
      for (const attrKey of Object.keys(this.data.sourceObject.system.talents[this.data.talentId].attributes)) {
        if (!Object.keys(formData.attributes).includes(attrKey)) {
          formData.attributes[`-=${attrKey}`] = null;
          delete this.data.sourceObject.system.attributes[attrKey];
          // delete the active effect
          const match = existingActiveEffects.find(i => i.name === attrKey);
          if (match) {
            CONFIG.logger.debug(`>>> Active effect located (${match.id}), deleting`);
            await this.data.sourceObject.deleteEmbeddedDocuments("ActiveEffect", [match.id]);
          }
        }
      }
    }

    CONFIG.logger.debug(">> Looking for new or updated ");
    // iterate over newly added or updated attributes and create the active effects
    if (Object.keys(formData).includes("attributes")) {
      for (const modKey of Object.keys(formData.attributes)) {
        CONFIG.logger.debug(">>> Checking modKey", modKey);
        if (modKey.startsWith("-=")) {
          CONFIG.logger.debug(`>>>> Skipping mod ${modKey} which will be deleted`);
          // skip anything queued for deletion
          continue;
        }

        const match = existingActiveEffects.find(i => i.name === modKey);
        const explodedMods = ModifierHelpers.explodeMod(
          formData.attributes[modKey].modtype,
          formData.attributes[modKey].mod
        );

        const changes = [];
        for (const curMod of explodedMods) {
          changes.push({
            key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
            type: "add",
            value: formData.attributes[modKey].value,
          });
        }

        if (match) {
          // existing entry
          CONFIG.logger.debug(`>>>> Staged AE changes for update: ${JSON.stringify(changes)}`);
          await match.update({
            changes: changes,
            disabled: !this.data.clickedObject.islearned,
          });
        } else {
          // new entry
          const effect = {
            name: modKey,
            changes: changes,
            disabled: !this.data.clickedObject.islearned,
          };
          CONFIG.logger.debug(`>>>> Staged AE for creation: ${JSON.stringify(effect)}`);
          await this.data.sourceObject.createEmbeddedDocuments("ActiveEffect", [effect]);
        }
      }
    }

    // merge it into the existing talent data
    formData = foundry.utils.mergeObject(
      this.data.sourceObject.system.talents[this.data.talentId],
      formData,
    );

    CONFIG.logger.debug(formData);

    await this.data.sourceObject.update({
      system: {
        talents: {
          [this.data.talentId]: formData,
        },
      },
    });
  }
}

export class forcePowerEditor extends itemEditor {
  /*
    Known issues:
    - The description rich text editor doesn't appear to work
  */
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        title: `Embedded Force Power Editor`, // should not be seen by anyone, as it is dynamically set on getData()
        //height: 720,
        width: 520,
        closeOnSubmit: false,
        submitOnClose: true,
        submitOnChange: true,
        resizable: true,
        classes: ["starwarsffg_sandbox", "flat_editor"],
        tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "tab1"}],
        scrollY: [".modification_container"],
      }
    );
  }

  /** @override */
  get template() {
    const path = "systems/starwarsffg_sandbox/templates/items/dialogs";
    return `${path}/ffg-embedded-upgrade.html`;
  }

    /** @override */
  async getData(options) {
    // update the title since it isn't available when creating the application
    this.options.title = game.i18n.format("SWFFG.Items.Popout.Title", {currentItem: this.data.clickedObject.name, parentItem: this.data.sourceObject.name});

    // build out the mod type and mod choices
    let modTypeChoices = CONFIG.FFG.allowableModifierTypes;
    let modChoices = CONFIG.FFG.allowableModifierChoices;
    let activations = CONFIG.FFG.activations;
    let data = await this._enrichData();

    let modifierChoices = CONFIG.FFG.allowableModifierChoices;

    // add in custom skills from the actor, if present
    if (this.data.sourceObject?.actor?.system?.skills) {
      const updatedChoices = foundry.utils.deepClone(modifierChoices);
      for (const modifierChoice of Object.keys(modifierChoices).filter(i => i.indexOf("Skill") >= 0)) {
        updatedChoices[modifierChoice] = this.data.sourceObject?.actor?.system?.skills;
      }
      data.modifierChoices = updatedChoices;
    }

    return {
      modTypeChoices: modTypeChoices,
      modChoices: modChoices,
      activations: activations,
      data: data,
    };
  }

  /**
   * Controls creating, deleting, or modifying mods (which contain modifiers)
   * @param event
   */
  async _modControl(event) {
    let action = event.currentTarget.getAttribute('data-action');
    if (action === 'create') {
      const nk = new Date().getTime();
      const modifierTypes = CONFIG.FFG.allowableModifierTypes;
      const modifierChoices = CONFIG.FFG.allowableModifierChoices;
      const modificationId = $(event.currentTarget).data("modification-id");
      const direct = this.data.clickedObject.type !== "itemattachment";

      CONFIG.logger.debug(`caught creating a new mod on an upgrade. data: ${modificationId}, ${direct}`);
      CONFIG.logger.debug(modifierTypes);
      CONFIG.logger.debug(modifierChoices);
      CONFIG.logger.debug(`expected new modtype is ${Object.keys(modifierTypes)[0]}`);
      CONFIG.logger.debug(`expected new mod mod is ${modifierChoices[Object.keys(modifierTypes)[0]]}`);

      let rendered = await foundry.applications.handlebars.renderTemplate(
        'systems/starwarsffg_sandbox/templates/items/dialogs/ffg-mod.html',
        {
          modifierTypes: modifierTypes,
          modifierChoices: modifierChoices,
          direct: direct,
          number: modificationId,
          attachmentType: 'all',
          id: `attr${nk}`,
          attr: {
            modtype: Object.keys(CONFIG.FFG.allowableModifierTypes)[0],
            mod: Object.keys(CONFIG.FFG.allowableModifierChoices[Object.keys(CONFIG.FFG.allowableModifierTypes)[0]])[0],
            value: 1,
          },
        }
      );

      $(event.currentTarget).parent().parent().children(".attributes-list").append(rendered);
      // update the listeners, so we catch events on these new entries
      this.activateListeners($(event.currentTarget).parent().parent().children(".attributes-list"));
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    } else if (action === 'delete') {
      $(event.currentTarget).parent().remove();
      // submit the changes so it gets saved even if the user reloads without closing the editor
      await this._updateObject(undefined, this._getSubmitData());
    }
  }

  /**
   * retrieves data and converts rich text editor fields into the enriched version. this results in things like dice displaying
   * @returns {Promise<*>}
   * @private
   */
  async _enrichData() {
    let enriched = this.data;
    enriched.clickedObject.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(this.data.clickedObject.description);
    return enriched;
  }

  /** @override */
  async _updateObject(event, formData) {
    CONFIG.logger.debug("Updating upgrade");
    formData = foundry.utils.expandObject(formData);

    // move attributes out of "system" since they aren't here for upgrades
    formData.attributes = formData.system?.attributes;
    delete formData.system?.attributes;
    // make sure attributes is a dictionary instead of whatever they end up being
    if (!Object.keys(formData).includes("attributes") || formData.attributes === undefined) {
      formData.attributes = {};
    }

    const existingActiveEffects = this.data.sourceObject.getEmbeddedCollection("ActiveEffect");

    // iterate over attributes on the specialization and remove any that aren't present in the form
    if (Object.keys(this.data.sourceObject.system.upgrades[this.data.upgradeId]).includes("attributes") && this.data.sourceObject.system.upgrades[this.data.upgradeId].attributes !== undefined) {
      for (const attrKey of Object.keys(this.data.sourceObject.system.upgrades[this.data.upgradeId].attributes)) {
        if (!Object.keys(formData.attributes).includes(attrKey)) {
          formData.attributes[`-=${attrKey}`] = null;
          delete this.data.sourceObject.system.attributes[attrKey];
          // delete the active effect
          const match = existingActiveEffects.find(i => i.name === attrKey);
          if (match) {
            CONFIG.logger.debug(`>>> Active effect located (${match.id}), deleting`);
            await this.data.sourceObject.deleteEmbeddedDocuments("ActiveEffect", [match.id]);
          }
        }
      }
    }

    CONFIG.logger.debug(">> Looking for new or updated ");
    // iterate over newly added or updated attributes and create the active effects
    if (Object.keys(formData).includes("attributes")) {
      for (const modKey of Object.keys(formData.attributes)) {
        CONFIG.logger.debug(">>> Checking modKey", modKey);
        if (modKey.startsWith("-=")) {
          CONFIG.logger.debug(`>>>> Skipping mod ${modKey} which will be deleted`);
          // skip anything queued for deletion
          continue;
        }

        const match = existingActiveEffects.find(i => i.name === modKey);
        const explodedMods = ModifierHelpers.explodeMod(
          formData.attributes[modKey].modtype,
          formData.attributes[modKey].mod
        );

        const changes = [];
        for (const curMod of explodedMods) {
          changes.push({
            key: ModifierHelpers.getModKeyPath(curMod['modType'], curMod['mod']),
            type: "add",
            value: formData.attributes[modKey].value,
          });
        }

        if (match) {
          // existing entry
          CONFIG.logger.debug(`>>>> Staged AE changes for update: ${JSON.stringify(changes)}`);
          await match.update({
            changes: changes,
            disabled: !this.data.clickedObject.islearned,
          });
        } else {
          // new entry
          const effect = {
            name: modKey,
            changes: changes,
            disabled: !this.data.clickedObject.islearned,
          };
          CONFIG.logger.debug(`>>>> Staged AE for creation: ${JSON.stringify(effect)}`);
          await this.data.sourceObject.createEmbeddedDocuments("ActiveEffect", [effect]);
        }
      }
    }


    // merge it into the existing upgrade data
    formData = foundry.utils.mergeObject(
      this.data.sourceObject.system.upgrades[this.data.upgradeId],
      formData,
    );

    CONFIG.logger.debug(formData);

    await this.data.sourceObject.update({
      system: {
        upgrades: {
          [this.data.upgradeId]: formData,
        },
      },
    });
  }
}
