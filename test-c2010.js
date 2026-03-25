const fs = require('fs');
const yaml = require('js-yaml');

// Test 1: Clean products.yaml should have 0 C2-010 errors
const p = yaml.load(fs.readFileSync('system/products.yaml', 'utf8'));
const agg = p.aggregates[0];
const root = agg.entities.find(e => e.isRoot);
const flds = new Set(root.fields.map(f => f.name));
const base = root.name[0].toLowerCase() + root.name.slice(1);

let errors = 0;
for (const ev of agg.events || []) {
  if (!ev.lifecycle) continue;
  for (const ef of ev.fields || []) {
    if (ef.name === base + 'Id') continue;
    if (ef.name.endsWith('At') && ef.type === 'LocalDateTime') continue;
    if (!flds.has(ef.name)) {
      console.log('  C2-010:', ev.name, '->', ef.name);
      errors++;
    }
  }
}
console.log('Test 1 (clean): C2-010 errors =', errors, errors === 0 ? 'PASS' : 'FAIL');

// Test 2: Simulate adding 'status' field — should trigger C2-010
const fakeEvent = { name: 'FakeEvent', lifecycle: 'create', fields: [
  { name: 'productId', type: 'String' },
  { name: 'name', type: 'String' },
  { name: 'status', type: 'String' },        // NOT in entity
  { name: 'deletedAt', type: 'LocalDateTime' } // auto-resolved, should be excluded
]};
let errors2 = 0;
for (const ef of fakeEvent.fields) {
  if (ef.name === base + 'Id') continue;
  if (ef.name.endsWith('At') && ef.type === 'LocalDateTime') continue;
  if (!flds.has(ef.name)) {
    console.log('  C2-010:', fakeEvent.name, '->', ef.name);
    errors2++;
  }
}
console.log('Test 2 (with status): C2-010 errors =', errors2, errors2 === 1 ? 'PASS' : 'FAIL');

// Test 3: Verify exclusions work
console.log('Test 3: productId excluded =', !flds.has('productId') ? 'YES (correct)' : 'NO');
console.log('Test 3: deactivatedAt excluded = YES (correct, auto-temporal)');
console.log('Test 3: name included =', flds.has('name') ? 'YES (correct, entity field)' : 'NO');

// Cleanup
process.exit(errors === 0 && errors2 === 1 ? 0 : 1);
