const defaultCategories = [
  { name: 'HVAC & Heating',      icon: 'mdi-air-filter',     color: '#FF5722', sortOrder: 1 },
  { name: 'Water, Well & Septic',icon: 'mdi-water-pump',     color: '#2196F3', sortOrder: 2 },
  { name: 'Vehicles',            icon: 'mdi-car',             color: '#607D8B', sortOrder: 3 },
  { name: 'Equipment',           icon: 'mdi-engine',          color: '#FF9800', sortOrder: 4 },
  { name: 'Exterior & Structure',icon: 'mdi-home-roof',       color: '#795548', sortOrder: 5 },
  { name: 'Land & Grounds',      icon: 'mdi-tree',            color: '#4CAF50', sortOrder: 6 },
  { name: 'Plumbing',            icon: 'mdi-pipe',            color: '#00BCD4', sortOrder: 7 },
  { name: 'Electrical & Safety', icon: 'mdi-lightning-bolt',  color: '#FFC107', sortOrder: 8 },
  { name: 'Appliances',          icon: 'mdi-washing-machine', color: '#9C27B0', sortOrder: 9 },
  { name: 'Pest & Seasonal',     icon: 'mdi-bug',             color: '#8BC34A', sortOrder: 10 },
];

// Subcategories keyed by parent category name
const defaultSubcategories = {
  'HVAC & Heating': [
    { name: 'Air Filters',    sortOrder: 1 },
    { name: 'Furnace / Boiler', sortOrder: 2 },
    { name: 'Air Conditioning', sortOrder: 3 },
    { name: 'Heat Pump',      sortOrder: 4 },
    { name: 'Ducts & Vents', sortOrder: 5 },
  ],
  'Water, Well & Septic': [
    { name: 'Well',           sortOrder: 1 },
    { name: 'Septic System',  sortOrder: 2 },
    { name: 'Water Softener', sortOrder: 3 },
    { name: 'Sump Pump',      sortOrder: 4 },
    { name: 'Water Heater',   sortOrder: 5 },
  ],
  'Plumbing': [
    { name: 'Water Heater',      sortOrder: 1 },
    { name: 'Fixtures & Faucets',sortOrder: 2 },
    { name: 'Drains',            sortOrder: 3 },
    { name: 'Pipes',             sortOrder: 4 },
  ],
  'Electrical & Safety': [
    { name: 'Smoke & CO Detectors', sortOrder: 1 },
    { name: 'Electrical Panel',     sortOrder: 2 },
    { name: 'Outlets & GFCI',       sortOrder: 3 },
    { name: 'Exterior Lighting',    sortOrder: 4 },
  ],
  'Appliances': [
    { name: 'Kitchen',  sortOrder: 1 },
    { name: 'Laundry',  sortOrder: 2 },
    { name: 'Other',    sortOrder: 3 },
  ],
  'Pest & Seasonal': [
    { name: 'Pest Control',  sortOrder: 1 },
    { name: 'Seasonal Prep', sortOrder: 2 },
  ],
  'Exterior & Structure': [
    { name: 'Roof',              sortOrder: 1 },
    { name: 'Foundation',        sortOrder: 2 },
    { name: 'Siding & Trim',     sortOrder: 3 },
    { name: 'Windows & Doors',   sortOrder: 4 },
    { name: 'Gutters & Drainage',sortOrder: 5 },
  ],
  'Land & Grounds': [
    { name: 'Lawn & Garden',      sortOrder: 1 },
    { name: 'Driveway & Walkways',sortOrder: 2 },
    { name: 'Fencing',            sortOrder: 3 },
    { name: 'Trees & Shrubs',     sortOrder: 4 },
  ],
  'Vehicles': [
    { name: 'Engine & Drivetrain', sortOrder: 1 },
    { name: 'Tires & Brakes',      sortOrder: 2 },
    { name: 'Fluids',              sortOrder: 3 },
    { name: 'Filters',             sortOrder: 4 },
    { name: 'Exterior',            sortOrder: 5 },
  ],
  'Equipment': [
    { name: 'Engine',              sortOrder: 1 },
    { name: 'Fuel & Fluids',       sortOrder: 2 },
    { name: 'Filters',             sortOrder: 3 },
    { name: 'Blades & Attachments',sortOrder: 4 },
  ],
};

async function seedDefaultCategories(userId) {
  const Category = require('./models/Category');
  const existing = await Category.countDocuments({ userId, parentId: null });
  if (existing > 0) return;
  await Category.insertMany(defaultCategories.map(c => ({ ...c, userId, parentId: null })));
}

async function seedDefaultSubcategories(userId) {
  const Category = require('./models/Category');
  const existingSubs = await Category.countDocuments({ userId, parentId: { $ne: null } });
  if (existingSubs > 0) return;

  const parents = await Category.find({ userId, parentId: null }).lean();
  const parentMap = new Map(parents.map(c => [c.name, c._id]));

  const toInsert = [];
  for (const [parentName, subs] of Object.entries(defaultSubcategories)) {
    const parentId = parentMap.get(parentName);
    if (!parentId) continue;
    subs.forEach(s => toInsert.push({ ...s, userId, parentId, icon: 'mdi-circle-small', color: '#9E9E9E' }));
  }
  if (toInsert.length) await Category.insertMany(toInsert);
}

module.exports = { seedDefaultCategories, seedDefaultSubcategories };
