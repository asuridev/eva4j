'use strict';

/**
 * Generates Mermaid classDiagram text per module from parsed domain.yaml objects.
 *
 * @param {Object} domainConfigs  Plain object { [moduleName]: parsedDomainYaml }
 * @returns {{ [moduleName]: string }}  Map of module → Mermaid diagram text (empty string if no aggregates)
 */
function generateDomainDiagrams(domainConfigs) {
  const result = {};
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    result[moduleName] = generateModuleDiagram(moduleName, config);
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

/** Normalize to PascalCase (capitalize first letter only). */
function toPascal(name) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function fieldPrefix(field) {
  if (field.hidden) return '-';
  if (field.readOnly) return '~';
  return '+';
}

// ── Per-module diagram builder ────────────────────────────────────────────────

function generateModuleDiagram(moduleName, config) {
  const aggregates = config.aggregates || [];
  if (aggregates.length === 0) return '';

  // Flat diagram — namespace blocks are avoided because Mermaid's layout engine
  // can place inner classes outside the visual boundary, causing overflow.
  // Aggregates are separated by %% comment dividers instead.
  const lines = ['classDiagram'];
  const relationships = []; // Collected per-aggregate, emitted at the end
  const notes = [];         // `note for ClassName "..."` — for cross-aggregate refs

  // Build a set of all entity/VO/enum PascalCase class names defined in this module
  // so we can distinguish intra-module from cross-aggregate relationships.
  const localClasses = new Set();
  for (const aggregate of aggregates) {
    for (const e of aggregate.entities || []) localClasses.add(toPascal(e.name));
    for (const v of aggregate.valueObjects || []) localClasses.add(toPascal(v.name));
    for (const en of aggregate.enums || []) localClasses.add(toPascal(en.name));
  }

  for (const aggregate of aggregates) {
    const entities = aggregate.entities || [];
    const valueObjects = aggregate.valueObjects || [];
    const enums = aggregate.enums || [];

    lines.push('');
    lines.push(`  %% ── Aggregate: ${aggregate.name} ─────────────────────`);

    // ── Entities ─────────────────────────────────────────────────────────────
    for (const entity of entities) {
      const className = toPascal(entity.name);
      lines.push(`  class ${className} {`);
      lines.push(`    ${entity.isRoot ? '<<aggregate root>>' : '<<entity>>'}`);

      for (const field of entity.fields || []) {
        if (AUDIT_FIELDS.has(field.name)) continue;
        lines.push(`    ${fieldPrefix(field)}${field.type} ${field.name}`);
      }

      if (entity.audit?.enabled) {
        lines.push(`    +LocalDateTime createdAt`);
        lines.push(`    +LocalDateTime updatedAt`);
      }
      if (entity.audit?.trackUser) {
        lines.push(`    +String createdBy`);
        lines.push(`    +String updatedBy`);
      }

      lines.push(`  }`);
    }

    // ── Value objects ─────────────────────────────────────────────────────────
    for (const vo of valueObjects) {
      const className = toPascal(vo.name);
      lines.push(`  class ${className} {`);
      lines.push(`    <<value object>>`);
      for (const field of vo.fields || []) {
        lines.push(`    +${field.type} ${field.name}`);
      }
      lines.push(`  }`);
    }

    // ── Enums ─────────────────────────────────────────────────────────────────
    for (const en of enums) {
      const className = toPascal(en.name);
      lines.push(`  class ${className} {`);
      lines.push(`    <<enumeration>>`);
      for (const val of en.values || []) {
        lines.push(`    ${val}`);
      }
      lines.push(`  }`);
    }

    // ── Collect relationships ─────────────────────────────────────────────────
    const voNames = new Set(valueObjects.map((v) => toPascal(v.name)));
    const enumNames = new Set(enums.map((e) => toPascal(e.name)));

    for (const entity of entities) {
      const srcClass = toPascal(entity.name);

      // Structural JPA relationships — only emit if target is a local class
      for (const rel of entity.relationships || []) {
        const target = toPascal(rel.target || rel.targetEntity || '');
        if (!target) continue;
        if (!localClasses.has(target)) continue; // skip cross-aggregate targets
        const label = rel.mappedBy ? ` : ${rel.mappedBy}` : '';
        switch (rel.type) {
          case 'OneToMany':
            relationships.push(`  ${srcClass} "1" --o "*" ${target}${label}`);
            break;
          case 'OneToOne':
            relationships.push(`  ${srcClass} "1" --o "1" ${target}${label}`);
            break;
          case 'ManyToOne':
            relationships.push(`  ${srcClass} "*" --> "1" ${target}`);
            break;
          case 'ManyToMany':
            relationships.push(`  ${srcClass} "*" --> "*" ${target}`);
            break;
          default:
            relationships.push(`  ${srcClass} --> ${target}${label}`);
        }
      }

      // Field-level type references within the same module (deduplicated)
      const seenEdges = new Set();
      const crossRefs = []; // cross-aggregate reference fields for this entity

      for (const field of entity.fields || []) {
        if (AUDIT_FIELDS.has(field.name)) continue;

        const fieldType = toPascal(field.type);

        if (enumNames.has(fieldType)) {
          const key = `${srcClass}-->${fieldType}`;
          if (!seenEdges.has(key)) {
            relationships.push(`  ${srcClass} --> ${fieldType} : ${field.name}`);
            seenEdges.add(key);
          }
        } else if (voNames.has(fieldType)) {
          const key = `${srcClass}*--${fieldType}`;
          if (!seenEdges.has(key)) {
            relationships.push(`  ${srcClass} *-- ${fieldType} : ${field.name}`);
            seenEdges.add(key);
          }
        } else if (field.reference) {
          // Cross-aggregate reference: render as a note instead of an arrow
          // to avoid undefined ghost nodes appearing outside the diagram.
          const refModule = field.reference.module;
          const refAggregate = field.reference.aggregate;
          const label =
            refModule && refModule !== moduleName
              ? `${field.name} → ${refAggregate} (${refModule})`
              : `${field.name} → ${refAggregate}`;
          crossRefs.push(label);
        }
      }

      if (crossRefs.length > 0) {
        notes.push(`  note for ${srcClass} "refs: ${crossRefs.join(', ')}"`);
      }
    }
  }

  if (relationships.length > 0) {
    lines.push('');
    lines.push(...relationships);
  }

  if (notes.length > 0) {
    lines.push('');
    lines.push(...notes);
  }

  return lines.join('\n');
}

module.exports = { generateDomainDiagrams };
