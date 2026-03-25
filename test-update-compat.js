#!/usr/bin/env node
/**
 * Verification: backward compatibility — no lifecycle events → old reconstruction pattern.
 * Also tests: lifecycle: update + lifecycle: delete → raise() is public.
 */
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const { resolveLifecycleEventArgs } = require('./src/utils/yaml-to-entity');

// ── Test 1: No lifecycle events ─────────────────────────────────────────────

const entityFields = [
  { name: 'id', javaType: 'String' },
  { name: 'name', javaType: 'String' },
  { name: 'price', javaType: 'BigDecimal' },
  { name: 'createdAt', javaType: 'LocalDateTime' },
  { name: 'updatedAt', javaType: 'LocalDateTime' }
];

const commandFields = entityFields.filter(f =>
  f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
  f.name !== 'createdBy' && f.name !== 'updatedBy' && f.name !== 'deletedAt' && !f.readOnly
);

const handlerTemplate = fs.readFileSync(path.join(__dirname, 'templates/crud/UpdateCommandHandler.java.ejs'), 'utf8');

const handlerNoLifecycle = ejs.render(handlerTemplate, {
  packageName: 'com.test',
  moduleName: 'products',
  aggregateName: 'Product',
  rootEntity: { fields: entityFields },
  commandFields: commandFields,
  oneToOneRelationships: [],
  oneToManyRelationships: [],
  lifecycleEventsMap: {}
});

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`✅ ${msg}`); }
  else { failed++; console.log(`❌ ${msg}`); }
}

console.log('=== Test 1: No lifecycle events (backward compat) ===\n');

assert(handlerNoLifecycle.includes('Product updated = new Product('), 'Handler uses full-constructor reconstruction');
assert(handlerNoLifecycle.includes('repository.save(updated)'), 'Handler saves updated (reconstructed)');
assert(!handlerNoLifecycle.includes('existing.update('), 'Handler does NOT call existing.update()');
assert(handlerNoLifecycle.includes('Reconstructs the Product'), 'Javadoc mentions reconstruction');

// ── Test 2: lifecycle: update + delete → raise() is public ──────────────────

console.log('\n=== Test 2: lifecycle update + delete → public raise() ===\n');

const lifecycleBoth = {
  update: [{ name: 'PUpdated', lifecycle: 'update', fields: [{ name: 'productId', javaType: 'String' }] }],
  delete: [{ name: 'PDeleted', lifecycle: 'delete', fields: [{ name: 'productId', javaType: 'String' }] }]
};
const resolvedBoth = resolveLifecycleEventArgs(lifecycleBoth, 'Product', entityFields, []);

const rootTemplate = fs.readFileSync(path.join(__dirname, 'templates/aggregate/AggregateRoot.java.ejs'), 'utf8');
const rootBoth = ejs.render(rootTemplate, {
  packageName: 'com.test',
  moduleName: 'products',
  name: 'Product',
  fields: entityFields,
  relationships: [],
  imports: ['import java.math.BigDecimal;'],
  valueObjects: [],
  aggregateMethods: [],
  auditable: true,
  hasSoftDelete: false,
  domainEvents: [{ name: 'PUpdated' }, { name: 'PDeleted' }],
  triggeredEventsMap: {},
  lifecycleEventsMap: resolvedBoth
});

const raiseMatch = rootBoth.match(/(public|protected) void raise\(DomainEvent/);
assert(raiseMatch && raiseMatch[1] === 'public', 'raise() is public when lifecycle:delete exists');
assert(rootBoth.includes('public void update('), 'update() method generated alongside delete lifecycle');

// ── Test 3: AggregateRoot without lifecycle → no update() method ────────────

console.log('\n=== Test 3: No lifecycle → no update() method ===\n');

const rootNoLifecycle = ejs.render(rootTemplate, {
  packageName: 'com.test',
  moduleName: 'products',
  name: 'Product',
  fields: entityFields,
  relationships: [],
  imports: ['import java.math.BigDecimal;'],
  valueObjects: [],
  aggregateMethods: [],
  auditable: true,
  hasSoftDelete: false,
  domainEvents: [],
  triggeredEventsMap: {},
  lifecycleEventsMap: {}
});

assert(!rootNoLifecycle.includes('public void update('), 'No update() method when no lifecycle events');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
