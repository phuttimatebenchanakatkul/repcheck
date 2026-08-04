/* RepCheck unit preferences + conversion helpers.
 *
 * One shared source of truth for the user's chosen units, set on the
 * Settings page and read by every feature that shows a weight, height,
 * distance, or clock time. Defaults: kg, cm, km, 12-hour clock (matching
 * how the app displayed times before this setting existed).
 *
 * Storage note: values are always STORED canonically (kg, cm, km) —
 * these helpers only convert at the display/input boundary, so changing
 * units never rewrites any logged data.
 *
 * Pages that render unit-dependent text should re-render on the
 * "repcheck:units-changed" event (same pattern as language switching).
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "repcheck_units_v1";
  const DEFAULTS = { weight: "kg", height: "cm", distance: "km", clock: "12h" };

  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;

  function getUnits() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
    } catch (err) {
      return { ...DEFAULTS };
    }
  }

  function setUnits(partial) {
    const next = { ...getUnits(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    document.dispatchEvent(new CustomEvent("repcheck:units-changed", { detail: next }));
  }

  // ---------- Weight ----------
  function weightUnitLabel() {
    return getUnits().weight === "lb" ? "lb" : "kg";
  }
  function kgToDisplay(kg) {
    // Number only (1 decimal), in the user's unit.
    const v = getUnits().weight === "lb" ? kg / KG_PER_LB : kg;
    return Math.round(v * 10) / 10;
  }
  function displayToKg(value) {
    const v = parseFloat(value);
    if (!isFinite(v)) return NaN;
    return getUnits().weight === "lb" ? v * KG_PER_LB : v;
  }
  function formatWeightKg(kg) {
    return `${kgToDisplay(kg)} ${weightUnitLabel()}`;
  }

  // ---------- Height ----------
  function heightUnitLabel() {
    return getUnits().height === "ftin" ? "ft/in" : "cm";
  }
  function formatHeightCm(cm) {
    if (getUnits().height !== "ftin") return `${Math.round(cm)} cm`;
    const totalIn = cm / CM_PER_IN;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn - ft * 12);
    // 5'12" reads wrong — carry it into the next foot.
    return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
  }

  // ---------- Distance ----------
  function formatDistanceKm(km) {
    if (getUnits().distance === "m") {
      return `${Math.round(km * 1000)}m`;
    }
    return `${km}km`;
  }

  // ---------- Clock ----------
  function hour12() {
    return getUnits().clock !== "24h";
  }
  function formatTime(dateOrMs) {
    const d = dateOrMs instanceof Date ? dateOrMs : new Date(dateOrMs);
    return d.toLocaleTimeString(RepCheckI18n.locale(), { hour: "numeric", minute: "2-digit", hour12: hour12() });
  }
  function formatHourLabel(hour) {
    // "1 AM" / "13:00" style labels for the nutrition timeline.
    if (!hour12()) return `${String(hour).padStart(2, "0")}:00`;
    const h = hour % 12 === 0 ? 12 : hour % 12;
    return `${h} ${hour < 12 ? "AM" : "PM"}`;
  }

  global.RepCheckUnits = {
    getUnits,
    setUnits,
    weightUnitLabel,
    kgToDisplay,
    displayToKg,
    formatWeightKg,
    heightUnitLabel,
    formatHeightCm,
    formatDistanceKm,
    hour12,
    formatTime,
    formatHourLabel,
  };
})(window);
