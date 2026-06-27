/**
 * Migration: assign subcategoryId to all existing maintenance tasks that lack one.
 *
 * Uses Claude to match each task title to the most appropriate subcategory
 * given its parent category.  Safe to re-run — skips tasks that already have
 * a subcategoryId.
 *
 * Dry-run (default):
 *   node src/scripts/assignSubcategories.js
 *
 * Apply changes:
 *   node src/scripts/assignSubcategories.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB   = require('../db');
const Category    = require('../models/Category');
const MaintenanceTask = require('../models/MaintenanceTask');
const Anthropic   = require('@anthropic-ai/sdk');

const APPLY = process.argv.includes('--apply');

async function run() {
  await connectDB();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey });

  // Load all tasks that have no subcategory but do have a category
  const tasks = await MaintenanceTask.find({
    subcategoryId: null,
    categoryId:    { $exists: true, $ne: null },
  })
    .populate('categoryId', 'name')
    .lean();

  if (!tasks.length) {
    console.log('No unclassified tasks found. Done.');
    process.exit(0);
  }

  console.log(`Found ${tasks.length} task(s) without a subcategory.`);

  // Collect unique userIds so we load each user's subcategory set once
  const userIds = [...new Set(tasks.map(t => String(t.userId)))];

  // Build a map: userId → { categoryId → [{ subId, subName }] }
  const userSubMap = {};
  for (const userId of userIds) {
    const allSubs = await Category.find({ userId, parentId: { $ne: null } }).lean();
    const map = {};
    for (const sub of allSubs) {
      const pid = String(sub.parentId);
      if (!map[pid]) map[pid] = [];
      map[pid].push({ id: String(sub._id), name: sub.name });
    }
    userSubMap[userId] = map;
  }

  // Group tasks by (userId, categoryId) so we can batch the Claude calls
  const groups = new Map(); // key: `userId:categoryId`
  for (const task of tasks) {
    const uid = String(task.userId);
    const cid = String(task.categoryId._id);
    const key = `${uid}:${cid}`;
    if (!groups.has(key)) {
      groups.set(key, {
        uid,
        cid,
        catName:      task.categoryId.name,
        subcategories: userSubMap[uid]?.[cid] || [],
        tasks:        [],
      });
    }
    groups.get(key).tasks.push(task);
  }

  const updates = []; // { taskId, subcategoryId, subcategoryName, taskTitle }

  for (const [key, group] of groups) {
    if (!group.subcategories.length) {
      console.log(`  [skip] "${group.catName}" has no subcategories — ${group.tasks.length} task(s) left unclassified`);
      continue;
    }

    const taskList = group.tasks.map((t, i) => `${i + 1}. "${t.title}" (id: ${t._id})`).join('\n');
    const subList  = group.subcategories.map(s => `- "${s.name}" (id: ${s.id})`).join('\n');

    const prompt = `You are classifying home maintenance tasks into subcategories.

Category: "${group.catName}"

Available subcategories:
${subList}

Tasks to classify:
${taskList}

Return ONLY a JSON array where each element is { "taskId": "<id>", "subcategoryId": "<id>" }.
Pick the single best-matching subcategory for each task. If no subcategory fits well, pick the closest one anyway — never return null.
No markdown, no explanation — just the JSON array.`;

    let raw;
    try {
      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      });
      raw = response.content[0]?.text || '';
    } catch (err) {
      console.error(`  [error] Claude call failed for "${group.catName}":`, err.message);
      continue;
    }

    let assignments;
    try {
      const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      assignments = JSON.parse(json);
    } catch {
      console.error(`  [error] Could not parse Claude response for "${group.catName}":`, raw.slice(0, 200));
      continue;
    }

    for (const a of assignments) {
      const sub = group.subcategories.find(s => s.id === a.subcategoryId);
      const task = group.tasks.find(t => String(t._id) === a.taskId);
      if (!sub || !task) continue;
      updates.push({ taskId: a.taskId, subcategoryId: a.subcategoryId, subcategoryName: sub.name, taskTitle: task.title, catName: group.catName });
    }
  }

  // Report
  console.log(`\n${updates.length} task(s) classified:\n`);
  for (const u of updates) {
    console.log(`  [${u.catName}] "${u.taskTitle}" → ${u.subcategoryName}`);
  }

  if (!APPLY) {
    console.log('\nDry run — no changes written. Pass --apply to commit.');
    process.exit(0);
  }

  // Apply updates
  let applied = 0;
  for (const u of updates) {
    await MaintenanceTask.updateOne({ _id: u.taskId }, { $set: { subcategoryId: u.subcategoryId } });
    applied++;
  }
  console.log(`\nApplied ${applied} update(s).`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
