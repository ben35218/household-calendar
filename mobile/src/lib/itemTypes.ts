// Item type definitions ported verbatim from client/src/views/ItemFormView.vue.
// The dynamic ItemForm renders these field groups; keeping them as data lets the
// mobile form mirror the web form exactly. Icons keep their `mdi-` prefix (use
// mdiName() to render with MaterialCommunityIcons).

export type FieldType = 'text' | 'date' | 'number' | 'select' | 'autocomplete' | 'textarea';

export interface ItemField {
  model?: string; // a core form field (name/manufacturer/modelNumber/…)
  customKey?: string; // a key in the customFields array
  label: string;
  type?: FieldType;
  options?: string[];
  placeholder?: string;
  hint?: string;
}

export interface FieldGroup {
  title: string;
  fields: ItemField[];
}

export interface ItemType {
  value: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  namePlaceholder: string;
  fieldGroups: FieldGroup[];
}

// When a type is selected, auto-pick this category by name (if it exists).
export const TYPE_CATEGORY_MATCH: Record<string, string> = {
  appliance: 'Appliances',
  vehicle: 'Vehicles & Equipment',
  system: 'HVAC & Heating',
  structure: 'Exterior & Structure',
  equipment: 'Vehicles & Equipment',
};

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 1949 }, (_, i) => String(currentYear - i));

const vehicleMakes = [
  'Ford', 'Chevrolet', 'GMC', 'Dodge', 'Ram', 'Chrysler', 'Jeep', 'Buick', 'Cadillac', 'Lincoln',
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Hyundai', 'Kia', 'Lexus', 'Acura',
  'Infiniti', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Volvo', 'Porsche', 'Land Rover', 'MINI',
  'Fiat', 'Alfa Romeo', 'Tesla', 'Rivian', 'Lucid', 'Polestar', 'John Deere', 'Kubota', 'Case IH',
  'New Holland', 'Massey Ferguson', 'Fendt', 'AGCO', 'Versatile', 'Claas', 'Polaris', 'Can-Am', 'BRP',
  'Yamaha', 'Kawasaki', 'Suzuki', 'Honda Powersports', 'Arctic Cat', 'Textron', 'CFMoto', 'Ariens',
  'Husqvarna', 'Toro', 'Troy-Bilt', 'Cub Cadet', 'Craftsman', 'Simplicity', 'MTD', 'Snapper', 'Other',
].sort();

export const ITEM_TYPES: ItemType[] = [
  {
    value: 'appliance',
    label: 'Appliance',
    icon: 'mdi-washing-machine',
    color: '#9C27B0',
    description: 'Fridge, washer, dryer, oven, dishwasher…',
    namePlaceholder: 'e.g. Samsung Refrigerator',
    fieldGroups: [
      {
        title: 'Make & Model',
        fields: [
          { model: 'manufacturer', label: 'Brand / Manufacturer', placeholder: 'e.g. Samsung' },
          { model: 'modelNumber', label: 'Model Number', placeholder: 'e.g. RF28R7351SR' },
          { model: 'serialNumber', label: 'Serial Number' },
        ],
      },
      {
        title: 'Purchase & Warranty',
        fields: [
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date' },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date' },
        ],
      },
    ],
  },
  {
    value: 'vehicle',
    label: 'Vehicle',
    icon: 'mdi-car',
    color: '#607D8B',
    description: 'Car, truck, tractor, ATV, snowblower…',
    namePlaceholder: 'e.g. 2019 Honda CR-V',
    fieldGroups: [
      {
        title: 'Vehicle Details',
        fields: [
          { customKey: 'Vehicle Type', label: 'Vehicle Type', type: 'select', options: ['Car / Sedan', 'Pickup Truck', 'SUV / Crossover', 'Van / Minivan', 'Motorcycle', 'Tractor', 'ATV / Quad', 'UTV / Side-by-Side', 'Snowblower', 'Riding Mower / Tractor', 'Walk-Behind Mower', 'Other'] },
          { customKey: 'Condition', label: 'Condition', type: 'select', options: ['Excellent', 'Good', 'Fair', 'Poor'] },
          { customKey: 'Year', label: 'Year', type: 'autocomplete', options: years },
          { model: 'manufacturer', label: 'Make', type: 'autocomplete', options: vehicleMakes, placeholder: 'Search makes…' },
          { model: 'modelNumber', label: 'Model', placeholder: 'e.g. F-150, CR-V, 1025R' },
          { customKey: 'Trim / Package', label: 'Trim / Package', placeholder: 'e.g. XLT, Sport, Lariat' },
          { customKey: 'Colour', label: 'Colour', type: 'select', options: ['Black', 'White', 'Silver / Grey', 'Red', 'Blue', 'Dark Blue / Navy', 'Green', 'Yellow', 'Orange', 'Brown / Beige / Tan', 'Gold', 'Other'] },
        ],
      },
    ],
  },
  {
    value: 'system',
    label: 'System',
    icon: 'mdi-air-filter',
    color: '#FF5722',
    description: 'HVAC, septic, well, electrical, plumbing…',
    namePlaceholder: 'e.g. Carrier Furnace, Septic System',
    fieldGroups: [
      {
        title: 'System Details',
        fields: [
          { customKey: 'System Type', label: 'System Type', type: 'select', options: ['Forced Air Furnace', 'Heat Pump', 'Boiler / Radiant', 'Central A/C', 'Mini-Split / Ductless', 'Septic System', 'Well & Pump', 'Water Softener', 'Water Heater / HWT', 'Sump Pump', 'Electrical Panel', 'Generator', 'Solar / PV System', 'Ventilation / HRV', 'Other'] },
          { customKey: 'Fuel / Energy Source', label: 'Fuel / Energy Source', type: 'select', options: ['Natural Gas', 'Propane', 'Oil / Diesel', 'Electric', 'Wood / Pellet', 'Solar', 'N/A'] },
          { model: 'manufacturer', label: 'Brand / Manufacturer', placeholder: 'e.g. Carrier, Trane' },
          { model: 'modelNumber', label: 'Model Number' },
          { model: 'serialNumber', label: 'Serial Number' },
        ],
      },
      {
        title: 'Capacity & Installation',
        fields: [
          { customKey: 'Capacity / Size', label: 'Capacity / Size', placeholder: 'e.g. 3-ton, 1,000-gal, 200A' },
          { customKey: 'Age / Condition', label: 'Condition', type: 'select', options: ['New', 'Excellent', 'Good', 'Fair', 'Poor', 'Unknown'] },
          { model: 'purchaseDate', label: 'Install Date', type: 'date' },
          { customKey: 'Expected Lifespan (yrs)', label: 'Expected Lifespan (yrs)', placeholder: 'e.g. 20' },
        ],
      },
      {
        title: 'Service Provider',
        fields: [
          { customKey: 'Service Company', label: 'Service Company' },
          { customKey: 'Service Phone', label: 'Service Phone' },
          { customKey: 'Last Service Date', label: 'Last Service Date', type: 'date' },
          { customKey: 'Service Contract Expiry', label: 'Service Contract Expiry', type: 'date' },
        ],
      },
    ],
  },
  {
    value: 'structure',
    label: 'Structure',
    icon: 'mdi-home-roof',
    color: '#795548',
    description: 'Roof, deck, foundation, barn, shed, fence…',
    namePlaceholder: 'e.g. Asphalt Roof, Back Deck',
    fieldGroups: [
      {
        title: 'Construction Details',
        fields: [
          { customKey: 'Structure Type', label: 'Structure Type', type: 'select', options: ['Roof', 'Deck / Patio', 'Foundation / Basement', 'Barn', 'Shed', 'Detached Garage', 'Fence / Gate', 'Driveway', 'Retaining Wall', 'Septic Drain Field', 'Well House', 'Other'] },
          { customKey: 'Primary Material', label: 'Primary Material', type: 'select', options: ['Asphalt Shingle', 'Metal Roofing', 'Cedar / Wood', 'Concrete', 'Brick / Masonry', 'Vinyl', 'Pressure-Treated Lumber', 'Steel', 'Other'] },
          { customKey: 'Year Built', label: 'Year Built', type: 'autocomplete', options: years },
          { customKey: 'Dimensions / Sq Ft', label: 'Dimensions / Sq Ft', placeholder: 'e.g. 400 sq ft' },
          { customKey: 'Condition', label: 'Condition', type: 'select', options: ['Excellent', 'Good', 'Fair', 'Poor', 'Needs Repair'] },
        ],
      },
      {
        title: 'Inspection & Permits',
        fields: [
          { customKey: 'Last Inspection Date', label: 'Last Inspection Date', type: 'date' },
          { customKey: 'Next Inspection Due', label: 'Next Inspection Due', type: 'date' },
          { customKey: 'Inspector / Contractor', label: 'Inspector / Contractor' },
          { customKey: 'Permit Number', label: 'Permit Number', placeholder: 'If applicable' },
        ],
      },
    ],
  },
  {
    value: 'equipment',
    label: 'Equipment',
    icon: 'mdi-engine',
    color: '#FF9800',
    description: 'Generator, chainsaw, pump, welder, tools…',
    namePlaceholder: 'e.g. Honda Generator, Husqvarna Chainsaw',
    fieldGroups: [
      {
        title: 'Make & Model',
        fields: [
          { model: 'manufacturer', label: 'Brand / Manufacturer', placeholder: 'e.g. Honda, Husqvarna' },
          { model: 'modelNumber', label: 'Model Number' },
          { model: 'serialNumber', label: 'Serial Number' },
          { customKey: 'Fuel Type', label: 'Fuel Type', type: 'select', options: ['Gasoline', 'Diesel', 'Propane', 'Electric / Battery', 'Manual / Hand-powered', 'Other'] },
          { customKey: 'Engine Size / Power', label: 'Engine Size / Power', placeholder: 'e.g. 5.5 HP, 250cc, 20V' },
        ],
      },
      {
        title: 'Usage & Service',
        fields: [
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date' },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date' },
          { customKey: 'Hours / Cycles Used', label: 'Hours / Cycles Used', placeholder: 'Current meter reading' },
          { customKey: 'Last Service Date', label: 'Last Service Date', type: 'date' },
        ],
      },
    ],
  },
  {
    value: 'other',
    label: 'Other',
    icon: 'mdi-package-variant',
    color: '#455A64',
    description: "Anything that doesn't fit above",
    namePlaceholder: 'Item name',
    fieldGroups: [
      {
        title: 'Details',
        fields: [
          { model: 'manufacturer', label: 'Manufacturer / Brand' },
          { model: 'modelNumber', label: 'Model Number' },
          { model: 'serialNumber', label: 'Serial Number' },
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date' },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date' },
        ],
      },
    ],
  },
];

export function itemTypeConfig(type?: string): ItemType {
  return ITEM_TYPES.find((t) => t.value === type) || ITEM_TYPES[ITEM_TYPES.length - 1];
}
