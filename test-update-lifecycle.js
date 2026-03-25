#!/usr/bin/env node
/**
 * Verification script: renders AggregateRoot.java.ejs and UpdateCommandHandler.java.ejs
 * with lifecycle: update event data and checks the output.
 */
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const { resolveLifecycleEventArgs } = require('./src/utils/yaml-to-entity');

// ── Test data ──────────────────────────────────────────────────────────────

const lifecycleEventsMapRaw = {
  update: [{
    name: 'ProductUpdatedEvent',
    lifecycle: 'update',
    fields: [
      { name: 'productId', javaType: 'String' },
      { name: 'name', javaType: 'String' },
      { name: 'price', javaType: 'BigDecimal' },
      { name: 'updatedAt', javaType: 'LocalDateTime' }
    ]
  }]
};

const entityFields = [
  { name: 'id', javaType: 'String' },
  { name: 'name', javaType: 'String' },
  { name: 'description', javaType: 'String' },
  { name: 'price', javaType: 'BigDecimal' },
  { name: 'status', javaType: 'ProductStatus', readOnly: true, autoInit: true, autoInitValue: 'DRAFT' },
  { name: 'createdAt', javaType: 'LocalDateTime' },
  { name: 'updatedAt', javaType: 'LocalDateTime' },
  { name: 'createdBy', javaType: 'String' },
  { name: 'updatedBy', javaType: 'String' }
];

const resolvedLifecycle = resolveLifecycleEventArgs(lifecycleEventsMapRaw, 'Product', entityFields, []);

// ── Render AggregateRoot ────────────────────────────────────────────────────

const rootTemplate = fs.readFileSync(path.join(__dirname, 'templates/aggregate/AggregateRoot.java.ejs'), 'utf8');
const rootResult = ejs.render(rootTemplate, {
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
  domainEvents: [{ name: 'ProductUpdatedEvent' }],
  triggeredEventsMap: {},
  lifecycleEventsMap: resolvedLifecycle
});

console.log('=== AggregateRoot.java (relevant sections) ===\n');

// Extract raise() visibility
const raiseMatch = rootResult.match(/(public|protected) void raise\(DomainEvent/);
console.log(`raise() visibility: ${raiseMatch ? raiseMatch[1] : 'NOT FOUND'}`);

// Extract update() method
const updateMethodMatch = rootResult.match(/\/\/ ─── Update Method[\s\S]*?(?=\n    \/\/ )/);
if (updateMethodMatch) {
  console.log('\nupdate() method:\n');
  console.log(updateMethodMatch[0]);
} else {
  console.log('\n❌ ERROR: update() method NOT generated!');
}

// ── Render UpdateCommandHandler ──────────────────────────────────────────────

const handlerTemplate = fs.readFileSync(path.join(__dirname, 'templates/crud/UpdateCommandHandler.java.ejs'), 'utf8');

const commandFields = entityFields.filter(f =>
  f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
  f.name !== 'createdBy' && f.name !== 'updatedBy' && f.name !== 'deletedAt' && !f.readOnly
);

const handlerResult = ejs.render(handlerTemplate, {
  packageName: 'com.test',
  moduleName: 'products',
  aggregateName: 'Product',
  rootEntity: { fields: entityFields },
  commandFields: commandFields,
  oneToOneRelationships: [],
  oneToManyRelationships: [],
  lifecycleEventsMap: resolvedLifecycle
});

console.log('\n\n=== UpdateCommandHandler.java ===\n');
console.log(handlerResult);

// ── Assertions ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`✅ ${msg}`); }
  else { failed++; console.log(`❌ ${msg}`); }
}

console.log('\n=== Assertions ===\n');

assert(raiseMatch && raiseMatch[1] === 'protected', 'raise() is protected (no lifecycle:delete)');
assert(rootResult.includes('public void update('), 'AggregateRoot has update() method');
assert(rootResult.includes('raise(new ProductUpdatedEvent('), 'update() method calls raise()');
assert(rootResult.includes('this.name = name;'), 'update() assigns fields');
assert(!handlerResult.includes('updated.raise('), 'Handler does NOT call updated.raise()');
assert(!handlerResult.includes('import com.test.products.domain.models.events'), 'Handler does NOT import domain events');
assert(handlerResult.includes('existing.update('), 'Handler calls existing.update()');
assert(handlerResult.includes('repository.save(existing)'), 'Handler saves existing (not updated)');
assert(!handlerResult.includes('Product updated = new Product('), 'Handler does NOT reconstruct entity');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
