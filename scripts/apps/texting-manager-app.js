import {
  getGrantedContacts,
  setGrantedContacts,
  getThread,
  appendMessage,
  deleteMessage,
  importConversation,
  markThreadRead,
  getUnreadThreads,
  removeDeadContact
} from "../texting.js";

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
      height: 680
    },
    actions: {
      sendAsContact: TextingManagerApp.#onSendAsContact,
      deleteMessage: TextingManagerApp.#onDeleteMessage,
      importConversation: TextingManagerApp.#onImportConversation,
      jumpToThread: TextingManagerApp.#onJumpToThread,
      removeDeadContact: TextingManagerApp.#onRemoveDeadContact
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

  /** @type {number|null} Captured scroll offset for the contacts checklist. */
  _savedChecklistScroll = null;

  /** @type {number|null} Captured scroll offset for the open thread. */
  _savedThreadScroll = null;

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

  /**
   * The crystal select, contact select, and every contact checkbox are
   * all wired up here via one delegated listener on the stable app root,
   * rather than through data-action. Foundry's action delegation is
   * reliably click-based; relying on it for "change" on selects and
   * checkboxes was what caused every field to appear to reset the
   * instant one was touched, since the state read back out often didn't
   * match what was actually clicked. This mirrors the same fix already
   * applied to the Scry poster dropdown for the same underlying reason.
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.target.tagName !== "TEXTAREA") return;
      const container = event.target.closest(".tm-composer");
      if (!container) return;
      event.preventDefault();
      container.querySelector("button[data-action]")?.click();
    });

    this.element.addEventListener("change", (event) => {
      const target = event.target;

      if (target.matches?.("#tm-crystal-select")) {
        this.selectedCrystalId = target.value || null;
        this.selectedContactId = null;
        this.render();
        return;
      }

      if (target.matches?.("#tm-contact-select")) {
        this.selectedContactId = target.value || null;
        if (this.selectedCrystalId && this.selectedContactId) {
          markThreadRead(this.selectedCrystalId, this.selectedContactId).then(() => this.render());
        } else {
          this.render();
        }
        return;
      }

      if (target.matches?.(".tm-contact-checkbox")) {
        const contactId = target.dataset.contactId;
        const current = new Set(getGrantedContacts(this.selectedCrystalId));
        if (target.checked) current.add(contactId);
        else current.delete(contactId);
        setGrantedContacts(this.selectedCrystalId, Array.from(current)).then(() => this.render());
      }
    });
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    const checklist = this.element?.querySelector(".tm-checklist");
    const thread = this.element?.querySelector(".tm-thread-scroll");
    this._savedChecklistScroll = checklist ? checklist.scrollTop : null;
    this._savedThreadScroll = thread ? thread.scrollTop : null;

    // Same issue as the phone — this window re-renders on any texting
    // activity anywhere, not just the thread currently open, so a
    // message landing in a completely different conversation could
    // wipe out a reply, or a half-pasted import script, mid-typing.
    this._savedDrafts = [];
    for (const el of this.element?.querySelectorAll("textarea") ?? []) {
      if (!el.value) continue;
      this._savedDrafts.push({
        name: el.name,
        value: el.value,
        focused: document.activeElement === el,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd
      });
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const checklist = this.element.querySelector(".tm-checklist");
    if (checklist && this._savedChecklistScroll != null) {
      checklist.scrollTop = this._savedChecklistScroll;
    }
    const thread = this.element.querySelector(".tm-thread-scroll");
    if (thread && this._savedThreadScroll != null) {
      thread.scrollTop = this._savedThreadScroll;
    }
    this._savedChecklistScroll = null;
    this._savedThreadScroll = null;

    for (const draft of this._savedDrafts ?? []) {
      const el = this.element.querySelector(`textarea[name="${draft.name}"]`);
      if (!el) continue;
      el.value = draft.value;
      if (draft.focused) {
        el.focus();
        el.setSelectionRange(draft.selectionStart, draft.selectionEnd);
      }
    }
    this._savedDrafts = [];
  }

  async _prepareContext(_options) {
    const actors = game.actors?.contents ?? [];
    if (!this.selectedCrystalId && actors.length) {
      this.selectedCrystalId = actors[0].id;
    }

    // Deliberately not filtering out unresolved actors here — that used
    // to happen, and it meant a thread involving a deleted or missing
    // Actor would still count toward the badge on the home screen but
    // vanish from this list entirely, leaving no way to ever find or
    // clear it. Better to surface it with a fallback label than hide it.
    const unreadThreads = getUnreadThreads().map(u => ({
      ...u,
      crystalName: game.actors.get(u.crystalId)?.name ?? `Unknown Actor (${u.crystalId})`,
      contactName: game.actors.get(u.contactId)?.name ?? `Unknown Actor (${u.contactId})`
    }));

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
    let contactExists = true;
    if (this.selectedContactId) {
      const contact = game.actors.get(this.selectedContactId);
      contactExists = !!contact;
      activeContactName = contact?.name ?? `Deleted Contact (${this.selectedContactId})`;
      thread = getThread(this.selectedCrystalId, this.selectedContactId).map(m => ({
        ...m,
        timeDisplay: new Date(m.timestamp).toLocaleString(),
        fromContact: m.senderId === this.selectedContactId
      }));
    }

    return {
      unreadThreads,
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
      contactExists,
      thread
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onJumpToThread(_event, target) {
    this.selectedCrystalId = target.dataset.crystalId;
    this.selectedContactId = target.dataset.contactId;
    await markThreadRead(this.selectedCrystalId, this.selectedContactId);
    this.render();
  }

  static async #onSendAsContact(_event, _target) {
    const input = this.element.querySelector('[name="tmMessage"]');
    const text = input?.value?.trim();
    if (!text || !this.selectedCrystalId || !this.selectedContactId) return;
    input.value = "";
    await appendMessage(this.selectedContactId, this.selectedCrystalId, text);
    await markThreadRead(this.selectedCrystalId, this.selectedContactId);
    this.render();
  }

  static async #onDeleteMessage(_event, target) {
    const messageId = target.dataset.messageId;
    if (!messageId || !this.selectedCrystalId || !this.selectedContactId) return;
    await deleteMessage(this.selectedCrystalId, this.selectedContactId, messageId);
    this.render();
  }

  /**
   * Cleans up a thread whose contact no longer exists — the grant
   * checklist can never surface this on its own, since it only lists
   * Actors that still exist, so this is the only way to actually get
   * rid of one.
   */
  static async #onRemoveDeadContact(_event, _target) {
    if (!this.selectedCrystalId || !this.selectedContactId) return;
    await removeDeadContact(this.selectedCrystalId, this.selectedContactId);
    this.selectedContactId = null;
    this.render();
  }

  static async #onImportConversation(_event, _target) {
    if (!this.selectedCrystalId || !this.selectedContactId) {
      ui.notifications.warn("Select a crystal and a granted contact before importing.");
      return;
    }
    const scriptInput = this.element.querySelector('[name="tmImportScript"]');
    const raw = scriptInput?.value ?? "";
    if (!raw.trim()) return;

    const spreadDaysInput = this.element.querySelector('[name="tmImportSpreadDays"]');
    const spreadDays = Number(spreadDaysInput?.value) || 0;
    const replaceCheckbox = this.element.querySelector('[name="tmImportReplace"]');
    const replace = !!replaceCheckbox?.checked;

    scriptInput.value = "";
    const { count } = await importConversation(this.selectedCrystalId, this.selectedContactId, raw, { spreadDays, replace });
    if (count === 0) {
      ui.notifications.warn('No valid lines found — each line needs to start with "Crystal:" or "Contact:".');
      // Put the pasted script back rather than losing it on a failed
      // import — looked up fresh rather than reusing scriptInput, in
      // case an intermediate re-render already replaced that element.
      const freshInput = this.element.querySelector('[name="tmImportScript"]');
      if (freshInput) freshInput.value = raw;
      return;
    }
    ui.notifications.info(`Imported ${count} message${count === 1 ? "" : "s"}.`);
    this.render();
  }
}
