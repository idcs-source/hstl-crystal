import { getBrokenCrystals, setCrystalBroken } from "../breakage.js";

const MODULE_ID = "hstl-crystal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only. A broken crystal isn't hidden or made unopenable — the
 * player can still open it, they just see it's broken, cracked screen
 * and all, instead of anything functional. That's the point: it needs
 * to be visible and undeniable in the moment ("why won't my phone
 * work"), not a silent lockout they might mistake for a bug.
 */
export class CrystalControlApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hstl-crystal-control",
    classes: ["hstl-crystal", "hstl-crystal-control"],
    tag: "div",
    window: {
      frame: true,
      positioned: true,
      title: "HSTL — Crystal Control",
      icon: "fa-solid fa-bolt",
      minimizable: true,
      resizable: true
    },
    position: {
      width: 360,
      height: 420
    },
    actions: {
      toggleBroken: CrystalControlApp.#onToggleBroken
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/crystal-control.hbs`
    }
  };

  static instance = null;

  static open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open Crystal Control.");
      return null;
    }
    if (!CrystalControlApp.instance) {
      CrystalControlApp.instance = new CrystalControlApp();
    }
    CrystalControlApp.instance.render(true);
    return CrystalControlApp.instance;
  }

  async _prepareContext(_options) {
    const broken = getBrokenCrystals();
    const players = game.users.contents
      .filter(u => !u.isGM)
      .map(u => ({
        id: u.id,
        name: u.name,
        isBroken: broken[u.id] === true,
        isActive: u.active
      }));

    return { players };
  }

  static async #onToggleBroken(_event, target) {
    const userId = target.dataset.userId;
    const currentlyBroken = target.dataset.broken === "true";
    await setCrystalBroken(userId, !currentlyBroken);
    this.render();
  }
}
