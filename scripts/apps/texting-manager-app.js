import { getGrantedContacts, setGrantedContacts, getThread, appendMessage } from "../texting.js";

const MODULE_ID = "hstl-crystal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only. Two jobs live here: deciding which Actors show up as
 * contacts on a given crystal (a checklist, since a crystal can have
 * any number of contacts and a contact can be granted to any number of
 * crystals), and actually replying as one of those contacts once a
 * player has texted them. Nothing here is player-facing — players use
 * the Texts app on the phone itself, which only ever sends as "self".
 */
export class TextingManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hstl-texting-manager",
    classes: ["hstl-crystal", "hstl-texting-manager"],
    tag: "div",
    window: {
      frame: true,
      positioned: true,
      title: "HSTL — Texting Manager",
      icon: "fa-solid fa-address-book",
      minimizable: true,
      resizable: true
    },
    position: {
      width: 520,
      height: 560
    },
    actions: {
      selectCrystal: TextingManagerApp.#onSelectCrystal,
      toggleContact: TextingManagerApp.#onToggleContact,
      selectContact: TextingManagerApp.#onSelectContact,
      sendAsContact: TextingManagerApp.#onSendAsContact
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/texting-manager.hbs`
    }
  };

  static instance = null;

  /** @type {string|null} Which Actor's inbox is being managed right now. */
  selectedCrystalId = null;

  /** @type {string|null} Which granted contact's thread is open for replying. */
  selectedContactId = null;

  /** @type {number|null} Captured scroll offset restored after the next re-render. */
  _savedScrollTop = null;

  static open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the Texting Manager.");
      return null;
    }
    if (!TextingManagerApp.instance) {
      TextingManagerApp.instance = new TextingManagerApp();
    }
    TextingManagerApp.instance.render(true);
    return TextingManagerApp.instance;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    const scroller = this.element?.querySelector(".tm-thread-scroll");
    this._savedScrollTop = scroller ? scroller.scrollTop : null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this._savedScrollTop == null) return;
    const scroller = this.element.querySelector(".tm-thread-scroll");
    if (scroller) scroller.scrollTop = this._savedScrollTop;
    this._savedScrollTop = null;
  }

  async _prepareContext(_options) {
    const actors = game.actors?.contents ?? [];
    if (!this.selectedCrystalId && actors.length) {
      this.selectedCrystalId = actors[0].id;
    }

    const grantedIds = this.selectedCrystalId ? getGrantedContacts(this.selectedCrystalId) : [];
    const grantedSet = new Set(grantedIds);

    // A crystal can't be its own contact.
    const contactChecklist = actors
      .filter(a => a.id !== this.selectedCrystalId)
      .map(a => ({ id: a.id, name: a.name, granted: grantedSet.has(a.id) }));

    // If a grant was revoked out from under the currently open thread,
    // don't leave the reply box pointed at a contact that's no longer valid.
    if (this.selectedContactId && !grantedSet.has(this.selectedContactId)) {
      this.selectedContactId = null;
    }

    let thread = [];
    let activeContactName = null;
    if (this.selectedContactId) {
      const contact = game.actors.get(this.selectedContactId);
      activeContactName = contact?.name ?? "Unknown";
      thread = getThread(this.selectedCrystalId, this.selectedContactId).map(m => ({
        ...m,
        timeDisplay: new Date(m.timestamp).toLocaleString(),
        fromContact: m.sender === "contact"
      }));
    }

    return {
      crystalOptions: actors.map(a => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.selectedCrystalId
      })),
      contactChecklist,
      grantedContacts: actors
        .filter(a => grantedSet.has(a.id))
        .map(a => ({ id: a.id, name: a.name, selected: a.id === this.selectedContactId })),
      selectedContactId: this.selectedContactId,
      activeContactName,
      thread
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onSelectCrystal(_event, target) {
    this.selectedCrystalId = target.value || null;
    this.selectedContactId = null;
    this.render();
  }

  static async #onToggleContact(_event, target) {
    const contactId = target.dataset.contactId;
    const current = new Set(getGrantedContacts(this.selectedCrystalId));
    if (target.checked) current.add(contactId);
    else current.delete(contactId);
    await setGrantedContacts(this.selectedCrystalId, Array.from(current));
    this.render();
  }

  static #onSelectContact(_event, target) {
    this.selectedContactId = target.value || null;
    this.render();
  }

  static async #onSendAsContact(_event, _target) {
    const input = this.element.querySelector('[name="tmMessage"]');
    const text = input?.value?.trim();
    if (!text || !this.selectedCrystalId || !this.selectedContactId) return;
    await appendMessage(this.selectedCrystalId, this.selectedContactId, "contact", text);
    input.value = "";
    this.render();
  }
}
