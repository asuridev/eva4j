'use strict';

const { faker } = require('@faker-js/faker');

// Set locale to English (US)
faker.locale = 'en_US';

// Deterministic seed for reproducible output
const DEFAULT_SEED = 42;

/**
 * Initialize faker with a seed for reproducibility.
 * @param {number} seed
 */
function initSeed(seed = DEFAULT_SEED) {
  faker.seed(seed);
}

// ── Field-name heuristics (order matters — first match wins) ────────────────

const NAME_HEURISTICS = [
  // Identity / person
  { pattern: /^(first[-_]?name)$/i,            gen: () => faker.person.firstName() },
  { pattern: /^(last[-_]?name|surname)$/i,      gen: () => faker.person.lastName() },
  { pattern: /^(full[-_]?name|customer[-_]?name|user[-_]?name|recipient[-_]?name|author[-_]?name|owner[-_]?name)$/i, gen: () => faker.person.fullName() },
  { pattern: /^(username|login|nick[-_]?name)$/i, gen: () => faker.internet.username() },
  { pattern: /^(name)$/i,                       gen: () => faker.commerce.productName() },

  // Contact
  { pattern: /email/i,                          gen: () => faker.internet.email() },
  { pattern: /^(phone|telephone|mobile|cell|fax)/i, gen: () => faker.phone.number({ style: 'international' }) },

  // Location / address
  { pattern: /^(street|street[-_]?address)$/i,  gen: () => faker.location.streetAddress() },
  { pattern: /^(city|town)$/i,                  gen: () => faker.location.city() },
  { pattern: /^(state|province|region)$/i,      gen: () => faker.location.state() },
  { pattern: /^(zip[-_]?code|postal[-_]?code)$/i, gen: () => faker.location.zipCode() },
  { pattern: /^(country)$/i,                    gen: () => faker.location.country() },
  { pattern: /^(address)$/i,                    gen: () => faker.location.streetAddress(true) },
  { pattern: /^(latitude|lat)$/i,               gen: () => faker.location.latitude() },
  { pattern: /^(longitude|lng|lon)$/i,          gen: () => faker.location.longitude() },

  // Financial / commerce
  { pattern: /^(price|amount|total|subtotal|tax|discount|balance|cost|fee|salary|income)$/i, gen: () => faker.commerce.price({ min: 5, max: 500 }) },
  { pattern: /^(currency)$/i,                   gen: () => faker.finance.currencyCode() },
  { pattern: /^(iban)$/i,                       gen: () => faker.finance.iban() },
  { pattern: /^(credit[-_]?card|card[-_]?number)$/i, gen: () => faker.finance.creditCardNumber() },

  // Text / content
  { pattern: /^(title|subject|headline)$/i,     gen: () => faker.commerce.productName() + ' ' + faker.word.noun() },
  { pattern: /^(description|summary|bio|about|notes|comment|message|body|content)$/i, gen: () => faker.commerce.productDescription() },
  { pattern: /^(slug)$/i,                       gen: () => faker.helpers.slugify(faker.commerce.productName()).toLowerCase() },

  // Web
  { pattern: /^(url|website|homepage|link|image[-_]?url|avatar[-_]?url|photo[-_]?url|logo[-_]?url)$/i, gen: () => faker.internet.url() },
  { pattern: /^(ip|ip[-_]?address)$/i,          gen: () => faker.internet.ip() },
  { pattern: /^(domain|host)$/i,                gen: () => faker.internet.domainName() },

  // Identifiers / codes
  { pattern: /^(order[-_]?number|invoice[-_]?number|reference[-_]?number|tracking[-_]?number)$/i, gen: () => `ORD-${faker.string.alphanumeric(6).toUpperCase()}` },
  { pattern: /^(sku|product[-_]?code|item[-_]?code|barcode)$/i, gen: () => faker.string.alphanumeric(8).toUpperCase() },
  { pattern: /^(code|token|key)$/i,             gen: () => faker.string.alphanumeric(10).toUpperCase() },

  // Company
  { pattern: /^(company|company[-_]?name|organization|brand)$/i, gen: () => faker.company.name() },
  { pattern: /^(department)$/i,                 gen: () => faker.commerce.department() },
  { pattern: /^(job[-_]?title|position|role)$/i, gen: () => faker.person.jobTitle() },

  // Dates (as strings for JSON)
  { pattern: /^(birth[-_]?date|date[-_]?of[-_]?birth|dob)$/i, gen: () => faker.date.birthdate({ min: 18, max: 65, mode: 'age' }).toISOString().split('T')[0] },

  // Quantity / counts
  { pattern: /^(quantity|qty|count|stock|units|capacity|size|weight|height|width|length|duration|age|rating|score|priority|order|rank|level|version)$/i, gen: () => faker.number.int({ min: 1, max: 100 }) },

  // Boolean semantic
  { pattern: /^(is[-_]?active|active|enabled|verified|published|available|visible|approved|completed|deleted|archived)$/i, gen: () => faker.datatype.boolean() },

  // Color
  { pattern: /^(color|colour)$/i,              gen: () => faker.color.human() },

  // Catch-all for *Id fields that reference another aggregate
  { pattern: /Id$/,                             gen: () => faker.string.uuid() },
];

// ── Type-based fallbacks ────────────────────────────────────────────────────

const TYPE_GENERATORS = {
  'String':        () => faker.word.words(3),
  'Integer':       () => faker.number.int({ min: 1, max: 1000 }),
  'int':           () => faker.number.int({ min: 1, max: 1000 }),
  'Long':          () => faker.number.int({ min: 10000, max: 99999 }),
  'long':          () => faker.number.int({ min: 10000, max: 99999 }),
  'Double':        () => parseFloat(faker.finance.amount({ min: 1, max: 999, dec: 2 })),
  'double':        () => parseFloat(faker.finance.amount({ min: 1, max: 999, dec: 2 })),
  'Float':         () => parseFloat(faker.finance.amount({ min: 1, max: 999, dec: 2 })),
  'float':         () => parseFloat(faker.finance.amount({ min: 1, max: 999, dec: 2 })),
  'BigDecimal':    () => faker.commerce.price({ min: 5, max: 500 }),
  'Boolean':       () => faker.datatype.boolean(),
  'boolean':       () => faker.datatype.boolean(),
  'LocalDate':     () => faker.date.recent({ days: 30 }).toISOString().split('T')[0],
  'LocalDateTime': () => faker.date.recent({ days: 30 }).toISOString().replace('Z', ''),
  'LocalTime':     () => faker.date.recent().toISOString().split('T')[1].substring(0, 8),
  'Instant':       () => faker.date.recent({ days: 30 }).toISOString(),
  'UUID':          () => faker.string.uuid(),
};

// ── Validation-aware overrides ──────────────────────────────────────────────

function applyValidationOverrides(field, baseValue) {
  const annotations = field.validationAnnotations || [];
  if (annotations.length === 0) return baseValue;

  let value = baseValue;

  for (const ann of annotations) {
    // @Email — always override to guarantee valid email format
    if (/@Email/i.test(ann)) return faker.internet.email();

    // @Future / @Past — always override to guarantee temporal constraint
    if (/@Future/i.test(ann)) return faker.date.future({ years: 1 }).toISOString().replace('Z', '');
    if (/@Past/i.test(ann)) return faker.date.past({ years: 2 }).toISOString().replace('Z', '');

    // @Pattern — always override (heuristic can't know regex)
    const patternMatch = ann.match(/@Pattern\s*\(.*?regexp\s*=\s*"([^"]+)"/);
    if (patternMatch) {
      const re = patternMatch[1];
      if (/^\^\[0-9\]|^\^\\d/.test(re)) return faker.string.numeric(6);
      if (/^\^\[A-Z\]/.test(re)) return faker.string.alpha({ length: 8, casing: 'upper' });
      return faker.string.alphanumeric(8);
    }

    // @NotBlank / @NotNull / @NotEmpty — ensure non-empty; keep base if already non-empty
    if (/@NotBlank|@NotEmpty|@NotNull/i.test(ann)) {
      if (value === null || value === undefined || value === '') {
        value = `example_${field.name}`;
      }
      continue; // don't return — check other annotations too
    }

    // @Positive / @PositiveOrZero / @Negative — constrain if base is numeric, else override
    if (/@PositiveOrZero/i.test(ann)) {
      if (typeof value === 'number') { value = Math.abs(value); }
      else { value = faker.number.int({ min: 0, max: 500 }); }
      continue;
    }
    if (/@Positive/i.test(ann)) {
      if (typeof value === 'number') { value = Math.max(1, Math.abs(value)); }
      else if (typeof value === 'string' && !isNaN(parseFloat(value))) {
        const n = Math.max(1, Math.abs(parseFloat(value)));
        value = String(n);
      } else { value = faker.number.int({ min: 1, max: 500 }); }
      continue;
    }
    if (/@Negative/i.test(ann)) {
      if (typeof value === 'number') { value = -Math.abs(value || 1); }
      else { value = faker.number.int({ min: -500, max: -1 }); }
      continue;
    }

    // @Min(n) — if base is numeric and below min, adjust; otherwise generate
    const minMatch = ann.match(/@Min\s*\(\s*(?:value\s*=\s*)?(\d+)/);
    if (minMatch) {
      const min = parseInt(minMatch[1], 10);
      if (typeof value === 'number' && value < min) { value = faker.number.int({ min, max: min + 100 }); }
      else if (typeof value !== 'number') { value = faker.number.int({ min, max: min + 100 }); }
      continue;
    }

    // @Max(n) — if base is numeric and above max, adjust; otherwise generate
    const maxMatch = ann.match(/@Max\s*\(\s*(?:value\s*=\s*)?(\d+)/);
    if (maxMatch) {
      const max = parseInt(maxMatch[1], 10);
      if (typeof value === 'number' && value > max) { value = faker.number.int({ min: 0, max }); }
      else if (typeof value !== 'number') { value = faker.number.int({ min: 0, max }); }
      continue;
    }

    // @Size(min, max) — constrain string length; keep base if fits, else truncate/pad
    const sizeMatch = ann.match(/@Size\s*\(.*?min\s*=\s*(\d+)(?:.*?max\s*=\s*(\d+))?/);
    if (sizeMatch) {
      const min = parseInt(sizeMatch[1], 10);
      const max = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : 255;
      if (typeof value === 'string') {
        if (value.length < min) {
          // Pad to min length
          value = value + faker.string.alpha(min - value.length);
        } else if (value.length > max) {
          // Truncate to max length
          value = value.substring(0, max);
        }
        // else: value length is within range — keep it
      } else {
        value = faker.string.alpha({ length: { min: Math.max(min, 1), max: Math.min(max, 50) } });
      }
      continue;
    }

    // @Digits(integer, fraction) — format as decimal with given precision
    const digitsMatch = ann.match(/@Digits\s*\(\s*integer\s*=\s*(\d+)(?:.*?fraction\s*=\s*(\d+))?/);
    if (digitsMatch) {
      const intPart = parseInt(digitsMatch[1], 10);
      const fracPart = digitsMatch[2] ? parseInt(digitsMatch[2], 10) : 0;
      const maxInt = Math.pow(10, Math.min(intPart, 6)) - 1;
      const num = faker.number.float({ min: 1, max: maxInt, fractionDigits: fracPart });
      value = fracPart > 0 ? num.toFixed(fracPart) : String(Math.floor(num));
      continue;
    }
  }

  return value;
}

// ── Core generation ─────────────────────────────────────────────────────────

/**
 * Generate a realistic fake value for a domain field.
 *
 * @param {Object} field           - Parsed field object from yaml-to-entity
 * @param {Array}  allEnums        - All enum definitions available in the module
 * @param {Array}  valueObjects    - All value object definitions in the aggregate
 * @param {number} depth           - Current recursion depth (for nested VOs)
 * @returns {*} A JSON-compatible fake value
 */
function generateFakeValue(field, allEnums = [], valueObjects = [], depth = 0) {
  const MAX_DEPTH = 3;
  if (depth >= MAX_DEPTH) return null;

  // 1. Enum → random pick from values
  if (field.isEnum) {
    const enumDef = allEnums.find(e => e.name === field.javaType);
    if (enumDef && enumDef.values && enumDef.values.length > 0) {
      return faker.helpers.arrayElement(enumDef.values);
    }
    return 'EXAMPLE_VALUE';
  }

  // 2. Value Objects → recursively generate nested fields
  if (field.isValueObject) {
    const voDef = valueObjects.find(vo => vo.name === field.javaType);
    if (voDef && voDef.fields) {
      const obj = {};
      voDef.fields.forEach(voField => {
        obj[voField.name] = generateFakeValue(voField, allEnums, valueObjects, depth + 1);
      });
      return obj;
    }
    // Fallback: heuristic by VO name
    return generateValueObjectFallback(field.javaType, field.name);
  }

  // 3. Collections
  if (field.isCollection) {
    return [faker.word.noun(), faker.word.noun()];
  }

  // 4. Field-name heuristic
  for (const rule of NAME_HEURISTICS) {
    if (rule.pattern.test(field.name)) {
      const val = rule.gen();
      return applyValidationOverrides(field, val);
    }
  }

  // 5. Type-based fallback
  const typeGen = TYPE_GENERATORS[field.javaType];
  if (typeGen) {
    return applyValidationOverrides(field, typeGen());
  }

  // 6. Absolute fallback
  return applyValidationOverrides(field, `example_${field.name}`);
}

/**
 * Fallback for value objects when no definition is found.
 */
function generateValueObjectFallback(typeName, fieldName) {
  const name = typeName.toLowerCase();
  if (name.includes('money') || name.includes('price') || name.includes('amount')) {
    return { amount: faker.commerce.price({ min: 5, max: 500 }), currency: faker.finance.currencyCode() };
  }
  if (name.includes('address')) {
    return { street: faker.location.streetAddress(), city: faker.location.city(), state: faker.location.state(), zipCode: faker.location.zipCode(), country: faker.location.country() };
  }
  if (name.includes('email')) {
    return { value: faker.internet.email() };
  }
  if (name.includes('phone')) {
    return { value: faker.phone.number({ style: 'international' }) };
  }
  return { value: faker.word.words(2) };
}

/**
 * Generate a full request body for an aggregate's command fields.
 *
 * @param {Array}  commandFields            - Writable fields (exclude id, audit, readOnly)
 * @param {Array}  oneToManyRelationships   - Enriched relationships from enrichRelationshipsRecursively
 * @param {Array}  allEnums                 - Module enums
 * @param {Array}  valueObjects             - Aggregate value objects
 * @returns {Object} A JSON-serialisable body object
 */
function generateFakeBody(commandFields, oneToManyRelationships = [], allEnums = [], valueObjects = []) {
  const body = {};

  commandFields.forEach(field => {
    body[field.name] = generateFakeValue(field, allEnums, valueObjects);
  });

  if (oneToManyRelationships && oneToManyRelationships.length > 0) {
    oneToManyRelationships.forEach(rel => {
      const obj = generateFakeNestedObject(rel, allEnums, valueObjects, 0);
      if (obj) {
        body[rel.fieldName] = [obj];
      }
    });
  }

  return body;
}

/**
 * Generate a fake object for a nested relationship.
 */
function generateFakeNestedObject(rel, allEnums, valueObjects, depth) {
  const MAX_DEPTH = 3;
  if (depth >= MAX_DEPTH) return null;

  const obj = {};

  if (rel.fields && rel.fields.length > 0) {
    rel.fields.filter(f => !f.readOnly && f.name !== 'id').forEach(field => {
      obj[field.name] = generateFakeValue(field, allEnums, valueObjects, depth + 1);
    });
  }

  // Recurse into nested OneToMany
  if (rel.hasNestedRelationships && rel.nestedRelationships) {
    rel.nestedRelationships.forEach(nestedRel => {
      const nestedObj = generateFakeNestedObject(nestedRel, allEnums, valueObjects, depth + 1);
      if (nestedObj) {
        obj[nestedRel.fieldName] = [nestedObj];
      }
    });
  }

  // Nested OneToOne
  if (rel.nestedOneToOneRelationships && rel.nestedOneToOneRelationships.length > 0) {
    rel.nestedOneToOneRelationships.forEach(otoRel => {
      const otoObj = {};
      (otoRel.fields || []).filter(f => !f.readOnly && f.name !== 'id').forEach(field => {
        otoObj[field.name] = generateFakeValue(field, allEnums, valueObjects, depth + 1);
      });
      obj[otoRel.fieldName] = otoObj;
    });
  }

  return obj;
}

/**
 * Generate example ID based on the id-field type.
 */
function generateFakeId(idType) {
  if (idType === 'UUID') return faker.string.uuid();
  if (idType === 'Long' || idType === 'Integer') return String(faker.number.int({ min: 1, max: 999 }));
  return faker.string.uuid();
}

module.exports = {
  initSeed,
  generateFakeValue,
  generateFakeBody,
  generateFakeNestedObject,
  generateFakeId,
};
