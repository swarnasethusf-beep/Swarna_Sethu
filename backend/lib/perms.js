/**
 * 🔐 Module permissions — one list, used by login, the session check and the admin screens.
 *  • super_admin  → everything
 *  • admin        → only the modules the owner switched on
 *  • goldsmith    → nothing (they only ever reach their own work orders and notifications)
 */
const MODULES = ["invoice", "inventory", "barcode", "staff", "reports", "workorders"];

const none = () => Object.fromEntries(MODULES.map((m) => [m, false]));

function permissionsFor(role, stored = {}) {
  if (role === "super_admin") return Object.fromEntries(MODULES.map((m) => [m, true]));
  if (role !== "admin") return none();
  return { ...none(), ...Object.fromEntries(MODULES.filter((m) => stored && stored[m]).map((m) => [m, true])) };
}

module.exports = { MODULES, permissionsFor };
