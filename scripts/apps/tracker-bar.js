import { getTracker } from "../tracker.js";

/**
 * A raw, fixed-position HUD bar rather than a Foundry Application window.
 * It has no header, no close button, and nothing for a player to click —
 * it just reflects the world-scoped `activeTracker` setting for every
 * connected client, GM included, and only the GM's own control panel
 * (TrackerControlApp) ever changes that setting.
 *
 * Kept as a single persistent DOM node appended once to document.body
 * rather than recreated on every update, so re-renders are just an
 * innerHTML swap.
 */
export class TrackerBar {
  static element = null;

  static #ensureMounted() {
    if (this.element && document.body.contains(this.element)) return;
    const el = document.createElement("div");
    el.id = "hstl-tracker-bar";
    document.body.appendChild(el);
    this.element = el;
  }

  static #escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /** Re-reads the current setting and updates the bar's visibility/content. */
  static render() {
    this.#ensureMounted();
    const data = getTracker();

    if (!data?.active) {
      this.element.classList.remove("hstl-tracker-bar-visible");
      return;
    }

    const pips = data.slots
      .map(state => `<span class="hstl-tracker-pip hstl-tracker-pip-${this.#escapeHtml(state)}"></span>`)
      .join("");

    this.element.innerHTML = `
      <span class="hstl-tracker-bar-label">${this.#escapeHtml(data.label || "HSTL Job Check")}</span>
      <div class="hstl-tracker-bar-pips">${pips}</div>
    `;
    this.element.classList.add("hstl-tracker-bar-visible");
  }
}
