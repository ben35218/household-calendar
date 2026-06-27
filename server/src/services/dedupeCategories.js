/**
 * Collapse duplicate categories within a household scope.
 *
 * Background: every user is seeded an identical set of default categories at
 * registration (scoped by userId). Household reads aggregate categories across
 * all members (`userId: { $in: scopeIds }`), so when a second member joins,
 * both members' identical default sets show up as duplicates.
 *
 * This merges duplicates by (parent, name): one survivor is kept and every
 * reference to the losers (items, maintenance tasks, child subcategories) is
 * repointed at the survivor before the losers are deleted.
 */
const Category = require('../models/Category');
const Item = require('../models/Item');
const MaintenanceTask = require('../models/MaintenanceTask');

const norm = (s) => (s || '').trim().toLowerCase();

/**
 * Pick which category in a duplicate group to keep.
 * Prefers a category owned by an earlier-listed `preferredUserIds` entry;
 * falls back to the oldest (then lowest _id) for a stable choice.
 */
function pickSurvivor(group, preferredUserIds) {
  const rank = (cat) => {
    const idx = preferredUserIds.findIndex((id) => String(id) === String(cat.userId));
    return idx === -1 ? preferredUserIds.length : idx;
  };
  return [...group].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const t = new Date(a.createdAt) - new Date(b.createdAt);
    if (t !== 0) return t;
    return String(a._id) < String(b._id) ? -1 : 1;
  })[0];
}

/** Repoint every reference from `dup` to `survivor`, then delete `dup`. */
async function absorb(dup, survivor, dryRun) {
  const dupId = dup._id;
  const survId = survivor._id;
  if (dryRun) return;
  await Item.updateMany({ categoryId: dupId }, { $set: { categoryId: survId } });
  await MaintenanceTask.updateMany({ categoryId: dupId }, { $set: { categoryId: survId } });
  await MaintenanceTask.updateMany({ subcategoryId: dupId }, { $set: { subcategoryId: survId } });
  // Reparent any children so subcategory duplicates collapse under one parent.
  await Category.updateMany({ parentId: dupId }, { $set: { parentId: survId } });
  await Category.deleteOne({ _id: dupId });
}

/**
 * Dedupe categories visible to a household scope.
 * @param {Array} memberIds       all userIds sharing the household
 * @param {Array} preferredUserIds ordered userIds whose copies win (e.g. owner,
 *                                 or existing members so a joiner's dups lose)
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun] report what would merge without mutating
 * @returns {{merged:number}} count of duplicate categories absorbed
 */
async function dedupeCategoriesForScope(memberIds, preferredUserIds = [], opts = {}) {
  const { dryRun = false } = opts;
  let merged = 0;

  // Pass 1: top-level categories. Reparenting in absorb() funnels children of
  // a merged parent onto the survivor, so pass 2 can collapse them.
  const tops = await Category.find({ userId: { $in: memberIds }, parentId: null }).lean();
  const topGroups = new Map();
  for (const cat of tops) {
    const key = norm(cat.name);
    if (!topGroups.has(key)) topGroups.set(key, []);
    topGroups.get(key).push(cat);
  }
  for (const group of topGroups.values()) {
    if (group.length < 2) continue;
    const survivor = pickSurvivor(group, preferredUserIds);
    for (const cat of group) {
      if (String(cat._id) === String(survivor._id)) continue;
      await absorb(cat, survivor, dryRun);
      merged++;
    }
  }

  // Pass 2: subcategories, grouped by (now-canonical parent, name).
  const subs = await Category.find({ userId: { $in: memberIds }, parentId: { $ne: null } }).lean();
  const subGroups = new Map();
  for (const cat of subs) {
    const key = `${cat.parentId}::${norm(cat.name)}`;
    if (!subGroups.has(key)) subGroups.set(key, []);
    subGroups.get(key).push(cat);
  }
  for (const group of subGroups.values()) {
    if (group.length < 2) continue;
    const survivor = pickSurvivor(group, preferredUserIds);
    for (const cat of group) {
      if (String(cat._id) === String(survivor._id)) continue;
      await absorb(cat, survivor, dryRun);
      merged++;
    }
  }

  return { merged };
}

module.exports = { dedupeCategoriesForScope };
