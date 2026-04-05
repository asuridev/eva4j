'use strict';

/**
 * Generates Mermaid flowchart (Bounded Context Blueprint) per module from parsed domain.yaml objects.
 *
 * The blueprint shows the full behavioral picture of a bounded context:
 * API surface, incoming events, use cases, aggregate structure, state machine,
 * outgoing events, sync ports, and read models — all in one diagram.
 *
 * @param {Object} domainConfigs  Plain object { [moduleName]: parsedDomainYaml }
 * @returns {{ [moduleName]: { diagram: string, useCases: Object } }}
 *   Map of module → { diagram (Mermaid text), useCases (detail metadata per UC) }
 */
function generateBlueprintDiagrams(domainConfigs) {
  const result = {};
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    result[moduleName] = generateModuleBlueprint(moduleName, config);
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPascal(name) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Sanitize a string for use as a Mermaid node ID (alphanumeric + underscore). */
function toNodeId(prefix, name) {
  return prefix + '_' + name.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Escape label text for Mermaid (quotes inside labels). */
function esc(text) {
  return text.replace(/"/g, '#quot;');
}

/** Truncate fields list: show first N fields, then "..." */
function summarizeFields(fields, max) {
  const filtered = (fields || []).filter(
    (f) => !AUDIT_FIELDS.has(f.name) && f.name !== 'id'
  );
  const shown = filtered.slice(0, max).map((f) => f.name);
  if (filtered.length > max) shown.push('...');
  return shown.join(' · ');
}

const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

// ── Subgraph style colors ─────────────────────────────────────────────────────

const COLORS = {
  api: { bg: '#1a2a4a', border: '#4A90D9', text: '#4A90D9' },
  asyncIn: { bg: '#1a3a2a', border: '#27AE60', text: '#27AE60' },
  commands: { bg: '#1e2533', border: '#5B7BA5', text: '#8EAECB' },
  queries: { bg: '#1e2533', border: '#5B7BA5', text: '#8EAECB' },
  aggregate: { bg: '#2a1a3a', border: '#8E44AD', text: '#B07CC6' },
  eventsOut: { bg: '#2a2215', border: '#E67E22', text: '#E67E22' },
  ports: { bg: '#152a2a', border: '#16A085', text: '#16A085' },
  readModels: { bg: '#1e2228', border: '#7F8C8D', text: '#95A5A6' },
};

// ── Per-module blueprint builder ──────────────────────────────────────────────

function generateModuleBlueprint(moduleName, config) {
  const aggregates = config.aggregates || [];
  if (aggregates.length === 0) return { diagram: '', useCases: {} };

  const lines = ['flowchart TD'];
  const edges = [];
  const styles = [];
  const clicks = []; // click-to-navigate directives
  const useCaseDetails = {}; // ucName → detail object

  // ── 1. Collect endpoints ────────────────────────────────────────────────
  const endpoints = config.endpoints;
  const epOperations = []; // { method, path, useCase }
  if (endpoints && endpoints.versions) {
    for (const ver of endpoints.versions) {
      for (const op of ver.operations || []) {
        epOperations.push({
          method: op.method,
          path: op.path,
          useCase: op.useCase,
          version: ver.version,
        });
      }
    }
  }

  // Group endpoints by base resource for compact display
  const epGroups = groupEndpointsByResource(epOperations, endpoints?.basePath || '');

  // ── 2. Collect listeners ────────────────────────────────────────────────
  const listeners = config.listeners || [];

  // ── 3. Derive use cases ─────────────────────────────────────────────────
  const commandUCs = new Map(); // useCase → nodeId
  const queryUCs = new Map();
  const seenUCs = new Set();

  for (const op of epOperations) {
    if (!op.useCase || seenUCs.has(op.useCase)) continue;
    seenUCs.add(op.useCase);
    if (op.method === 'GET') {
      queryUCs.set(op.useCase, toNodeId('Q', op.useCase));
    } else {
      commandUCs.set(op.useCase, toNodeId('CMD', op.useCase));
    }
  }
  for (const listener of listeners) {
    if (!listener.useCase || seenUCs.has(listener.useCase)) continue;
    seenUCs.add(listener.useCase);
    commandUCs.set(listener.useCase, toNodeId('CMD', listener.useCase));
  }

  // ── 4. Collect events (outgoing) ────────────────────────────────────────
  const outEvents = [];
  for (const agg of aggregates) {
    for (const ev of agg.events || []) {
      outEvents.push(ev);
    }
  }

  // ── 5. Collect ports ────────────────────────────────────────────────────
  const ports = config.ports || [];
  const portsByService = new Map();
  for (const port of ports) {
    const svc = port.service || 'UnknownService';
    if (!portsByService.has(svc)) portsByService.set(svc, []);
    portsByService.get(svc).push(port);
  }

  // ── 6. Collect read models ──────────────────────────────────────────────
  const readModels = config.readModels || [];

  // ── Build subgraphs ────────────────────────────────────────────────────

  // ── API Surface ─────────────────────────────────────────────────────────
  if (epGroups.length > 0) {
    lines.push('');
    lines.push('  subgraph API["🌐 API Surface"]');
    for (const group of epGroups) {
      const nodeId = toNodeId('EP', group.resource || 'root');
      const methodsLabel = group.methods.join(' · ');
      lines.push(`    ${nodeId}["${esc(methodsLabel)}"]`);
    }
    lines.push('  end');
    styles.push(
      ...styleSubgraph('API', COLORS.api)
    );
  }

  // ── Incoming Events ─────────────────────────────────────────────────────
  if (listeners.length > 0) {
    lines.push('');
    lines.push('  subgraph ASYNC_IN["📥 Incoming Events"]');
    for (const listener of listeners) {
      const nodeId = toNodeId('EI', listener.event);
      const producer = listener.producer ? ` ← ${listener.producer}` : '';
      lines.push(
        `    ${nodeId}["${esc(listener.event + producer)}"]`
      );
    }
    lines.push('  end');
    styles.push(...styleSubgraph('ASYNC_IN', COLORS.asyncIn));
  }

  // ── Commands ────────────────────────────────────────────────────────────
  if (commandUCs.size > 0) {
    lines.push('');
    lines.push('  subgraph COMMANDS["⚙️ Commands"]');
    for (const [uc, nodeId] of commandUCs) {
      lines.push(`    ${nodeId}["${esc(uc)}"]`);
      clicks.push(`  click ${nodeId} __evaNodeClick "${esc(uc)}"`);
    }
    lines.push('  end');
    styles.push(...styleSubgraph('COMMANDS', COLORS.commands));
  }

  // ── Queries ─────────────────────────────────────────────────────────────
  if (queryUCs.size > 0) {
    lines.push('');
    lines.push('  subgraph QUERIES["🔍 Queries"]');
    for (const [uc, nodeId] of queryUCs) {
      lines.push(`    ${nodeId}["${esc(uc)}"]`);
      clicks.push(`  click ${nodeId} __evaNodeClick "${esc(uc)}"`);
    }
    lines.push('  end');
    styles.push(...styleSubgraph('QUERIES', COLORS.queries));
  }

  // ── Aggregate ───────────────────────────────────────────────────────────
  for (const agg of aggregates) {
    const aggId = `AGG_${agg.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    lines.push('');
    lines.push(`  subgraph ${aggId}["📦 ${esc(agg.name)}"]`);
    lines.push('    direction TB');

    const entities = agg.entities || [];
    const valueObjects = agg.valueObjects || [];
    const enums = agg.enums || [];

    // Entities
    for (const entity of entities) {
      const entId = toNodeId('ENT', entity.name);
      const marker = entity.isRoot ? '🔶 ' : '';
      const fieldsSummary = summarizeFields(entity.fields, 4);
      const label = fieldsSummary
        ? `${marker}${toPascal(entity.name)}\\n${fieldsSummary}`
        : `${marker}${toPascal(entity.name)}`;
      lines.push(`    ${entId}["${esc(label)}"]`);

      // Cross-aggregate references
      for (const field of entity.fields || []) {
        if (field.reference) {
          const refMod = field.reference.module;
          const refAgg = field.reference.aggregate;
          const refLabel =
            refMod && refMod !== moduleName
              ? `${field.name} → ${refAgg} (${refMod})`
              : `${field.name} → ${refAgg}`;
          const refId = toNodeId('REF', field.name + '_' + refAgg);
          lines.push(`    ${refId}("🔗 ${esc(refLabel)}"):::refNode`);
          edges.push(`    ${entId} -.- ${refId}`);
        }
      }
    }

    // Value Objects
    for (const vo of valueObjects) {
      const voId = toNodeId('VO', vo.name);
      const fieldsSummary = summarizeFields(vo.fields, 3);
      const label = fieldsSummary
        ? `💎 ${toPascal(vo.name)}\\n${fieldsSummary}`
        : `💎 ${toPascal(vo.name)}`;
      lines.push(`    ${voId}["${esc(label)}"]`);
    }

    // Enums — show transition flow inline if available
    for (const en of enums) {
      const enumId = toNodeId('ENUM', en.name);
      let label = `🔄 ${toPascal(en.name)}`;
      if (en.transitions && en.transitions.length > 0) {
        const transitionMap = buildTransitionSummary(en);
        label += `\\n${transitionMap}`;
      } else if (en.values) {
        label += `\\n${en.values.join(' · ')}`;
      }
      lines.push(`    ${enumId}["${esc(label)}"]`);
    }

    // Intra-aggregate edges (entity→VO, entity→enum, entity→entity)
    for (const entity of entities) {
      const entId = toNodeId('ENT', entity.name);
      for (const rel of entity.relationships || []) {
        const target = toPascal(rel.target || rel.targetEntity || '');
        if (!target) continue;
        const targetEntity = entities.find(
          (e) => toPascal(e.name) === target
        );
        if (targetEntity) {
          const targetId = toNodeId('ENT', targetEntity.name);
          const relLabel = rel.type === 'OneToMany' ? '1:N' : rel.type === 'OneToOne' ? '1:1' : '';
          edges.push(`    ${entId} -->|"${relLabel}"| ${targetId}`);
        }
      }
      // Field-type references to VOs and Enums
      for (const field of entity.fields || []) {
        if (AUDIT_FIELDS.has(field.name)) continue;
        const fType = toPascal(field.type);
        const matchingVO = valueObjects.find((v) => toPascal(v.name) === fType);
        if (matchingVO) {
          edges.push(`    ${entId} -.->|"VO"| ${toNodeId('VO', matchingVO.name)}`);
        }
        const matchingEnum = enums.find((e) => toPascal(e.name) === fType);
        if (matchingEnum) {
          edges.push(`    ${entId} -.->|"status"| ${toNodeId('ENUM', matchingEnum.name)}`);
        }
      }
    }

    lines.push('  end');
    styles.push(...styleSubgraph(aggId, COLORS.aggregate));
  }

  // ── Outgoing Events ─────────────────────────────────────────────────────
  if (outEvents.length > 0) {
    lines.push('');
    lines.push('  subgraph EVENTS_OUT["📤 Outgoing Events"]');
    for (const ev of outEvents) {
      const evId = toNodeId('EO', ev.name);
      const payload = (ev.fields || [])
        .filter((f) => !f.name.match(/Id$/i) || ev.fields.length <= 2)
        .slice(0, 3)
        .map((f) => f.name)
        .join(' · ');
      const label = payload
        ? `${ev.name}\\n${payload}`
        : ev.name;
      lines.push(`    ${evId}["${esc(label)}"]`);
    }
    lines.push('  end');
    styles.push(...styleSubgraph('EVENTS_OUT', COLORS.eventsOut));
  }

  // ── Sync Ports ──────────────────────────────────────────────────────────
  if (portsByService.size > 0) {
    lines.push('');
    lines.push('  subgraph PORTS["🔗 Sync Ports"]');
    for (const [svc, methods] of portsByService) {
      const svcId = toNodeId('PORT', svc);
      const httpMethods = methods
        .map((m) => {
          const parts = (m.http || '').split(' ');
          return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : m.name;
        })
        .join('\\n');
      const target = methods[0]?.target ? ` → ${methods[0].target}` : '';
      lines.push(`    ${svcId}["${esc(svc + target)}\\n${esc(httpMethods)}"]`);
    }
    lines.push('  end');
    styles.push(...styleSubgraph('PORTS', COLORS.ports));
  }

  // ── Read Models ─────────────────────────────────────────────────────────
  if (readModels.length > 0) {
    lines.push('');
    lines.push('  subgraph READ_MODELS["📦 Read Models"]');
    for (const rm of readModels) {
      const rmId = toNodeId('RM', rm.name);
      const actions = [...new Set((rm.syncedBy || []).map((s) => s.action))].join(' · ');
      const source = rm.source ? ` ← ${rm.source.module}` : '';
      lines.push(`    ${rmId}["${esc(rm.name + source)}\\n${esc(actions)}"]`);
    }
    lines.push('  end');
    styles.push(...styleSubgraph('READ_MODELS', COLORS.readModels));
  }

  // ── Edges ───────────────────────────────────────────────────────────────

  lines.push('');
  lines.push('  %% ── Connections ──────────────────────────────');

  // EP groups → Use Cases
  for (const group of epGroups) {
    const epNodeId = toNodeId('EP', group.resource || 'root');
    for (const uc of group.useCases) {
      const targetId = queryUCs.get(uc) || commandUCs.get(uc);
      if (targetId) {
        edges.push(`  ${epNodeId} --> ${targetId}`);
      }
    }
  }

  // Incoming Events → Use Cases
  for (const listener of listeners) {
    const eiId = toNodeId('EI', listener.event);
    const targetId = commandUCs.get(listener.useCase);
    if (targetId) {
      edges.push(`  ${eiId} --> ${targetId}`);
    }
  }

  // Commands → Aggregate (first aggregate root)
  const firstAgg = aggregates[0];
  if (firstAgg && commandUCs.size > 0) {
    const aggId = `AGG_${firstAgg.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    for (const [, nodeId] of commandUCs) {
      edges.push(`  ${nodeId} --> ${aggId}`);
    }
  }

  // Aggregate → Outgoing Events
  if (firstAgg && outEvents.length > 0) {
    const aggId = `AGG_${firstAgg.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    for (const ev of outEvents) {
      edges.push(`  ${aggId} --> ${toNodeId('EO', ev.name)}`);
    }
  }

  // Commands → Ports (dotted — sync calls)
  if (portsByService.size > 0) {
    // Connect all commands to all ports (in a real scenario, specific UCs call specific ports)
    // but from domain.yaml alone we can't determine which UC calls which port.
    // Use dotted lines from the aggregate to ports to indicate dependency.
    if (firstAgg) {
      const aggId = `AGG_${firstAgg.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      for (const [svc] of portsByService) {
        edges.push(`  ${aggId} -.->|"sync"| ${toNodeId('PORT', svc)}`);
      }
    }
  }

  // Deduplicate edges
  const uniqueEdges = [...new Set(edges)];
  lines.push(...uniqueEdges);

  // ── Styles ──────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  %% ── Styles ──────────────────────────────────');
  lines.push(...styles);
  lines.push('  classDef refNode fill:#2a2a3a,stroke:#7F8C8D,stroke-width:1px,color:#95A5A6,font-size:11px');

  // ── Click directives ────────────────────────────────────────────────────
  if (clicks.length > 0) {
    lines.push('');
    lines.push('  %% ── Click handlers ─────────────────────────');
    lines.push(...clicks);
  }

  // ── Build use case detail metadata ──────────────────────────────────────
  const allTransitions = [];
  const allEvents = [];
  for (const agg of aggregates) {
    for (const en of agg.enums || []) {
      for (const tr of en.transitions || []) {
        const froms = Array.isArray(tr.from) ? tr.from : [tr.from];
        allTransitions.push({ method: tr.method, froms, to: tr.to, guard: tr.guard, enum: en.name });
      }
    }
    for (const ev of agg.events || []) {
      allEvents.push(ev);
    }
  }

  const rootEntity = aggregates[0]?.entities?.find((e) => e.isRoot) || aggregates[0]?.entities?.[0];
  const aggName = aggregates[0]?.name || moduleName;

  // Helper: derive standard CRUD descriptions
  function describeStandardUC(ucName) {
    const entity = aggName;
    if (ucName === `Create${entity}`)    return `Crea una nueva instancia de ${entity} y la persiste en el repositorio.`;
    if (ucName === `Update${entity}`)    return `Actualiza los campos modificables de un ${entity} existente.`;
    if (ucName === `Delete${entity}`)    return `Elimina un ${entity} del repositorio${rootEntity?.hasSoftDelete ? ' (soft delete)' : ''}.`;
    if (ucName === `Get${entity}`)       return `Obtiene un ${entity} por su identificador.`;
    if (ucName.startsWith('FindAll'))    return `Lista todos los ${entity} disponibles con soporte de paginación.`;
    return null;
  }

  for (const [ucName, nodeId] of [...commandUCs, ...queryUCs]) {
    const type = queryUCs.has(ucName) ? 'query' : 'command';
    const detail = { name: ucName, type };

    // Endpoint info
    const ep = epOperations.find((o) => o.useCase === ucName);
    if (ep) {
      const basePath = config.endpoints?.basePath || '';
      detail.endpoint = {
        method: ep.method,
        path: (basePath + (ep.path || '')).replace(/\/+/g, '/'),
        version: ep.version || null,
      };
    }

    // Listener info
    const listener = listeners.find((l) => l.useCase === ucName);
    if (listener) {
      detail.triggeredBy = {
        event: listener.event,
        producer: listener.producer || null,
        topic: listener.topic || null,
      };
    }

    // Aggregate
    detail.aggregate = aggName;

    // State transitions triggered
    const matchedTransitions = allTransitions.filter((t) => {
      // Match by method name similarity to UC name
      // e.g. confirm → ConfirmOrder, cancel → CancelOrder
      return ucName.toLowerCase().includes(t.method.toLowerCase());
    });
    if (matchedTransitions.length > 0) {
      detail.stateTransitions = matchedTransitions.map((t) => ({
        method: t.method,
        from: t.froms.join(', '),
        to: t.to,
        guard: t.guard || null,
        enum: t.enum,
      }));
    }

    // Events emitted
    const matchedEvents = allEvents.filter((ev) => {
      // Match by triggers
      if (ev.triggers) {
        return ev.triggers.some((trigger) => ucName.toLowerCase().includes(trigger.toLowerCase()));
      }
      // Match by lifecycle
      if (ev.lifecycle) {
        const lcMap = { create: 'Create', update: 'Update', delete: 'Delete', softDelete: 'Delete' };
        return ucName.startsWith(lcMap[ev.lifecycle] || '');
      }
      return false;
    });
    if (matchedEvents.length > 0) {
      detail.eventsEmitted = matchedEvents.map((ev) => ({
        name: ev.name,
        fields: (ev.fields || []).map((f) => f.name + ': ' + f.type),
      }));
    }

    // Ports used (we can't know exactly which UC calls which port from domain.yaml,
    // but we list all available ports as "available sync dependencies")
    if (ports.length > 0) {
      detail.availablePorts = [];
      for (const [svc, methods] of portsByService) {
        detail.availablePorts.push({
          service: svc,
          target: methods[0]?.target || null,
          methods: methods.map((m) => m.http || m.name),
        });
      }
    }

    // Request fields (from root entity, non-readOnly, non-audit for commands)
    if (type === 'command' && rootEntity && ep) {
      const isCreate = ucName.startsWith('Create');
      const reqFields = (rootEntity.fields || [])
        .filter((f) => !AUDIT_FIELDS.has(f.name) && f.name !== 'id' && f.name !== 'deletedAt')
        .filter((f) => !f.readOnly)
        .map((f) => ({ name: f.name, type: f.type, required: !!(f.validations?.length) }));
      if (reqFields.length > 0) detail.requestFields = reqFields;
    }

    // Description
    const stdDesc = describeStandardUC(ucName);
    if (stdDesc) {
      detail.description = stdDesc;
      detail.isStandard = true;
    } else {
      // Custom use case — build description from context
      const parts = [];
      if (detail.triggeredBy) {
        parts.push(`Se ejecuta al recibir el evento ${detail.triggeredBy.event}${detail.triggeredBy.producer ? ' del módulo ' + detail.triggeredBy.producer : ''}.`);
      }
      if (detail.stateTransitions) {
        for (const t of detail.stateTransitions) {
          parts.push(`Invoca ${t.method}() que transiciona ${t.enum} de [${t.from}] → ${t.to}${t.guard ? ' (guard: ' + t.guard + ')' : ''}.`);
        }
      }
      if (detail.eventsEmitted) {
        parts.push(`Emite: ${detail.eventsEmitted.map((e) => e.name).join(', ')}.`);
      }
      if (ep && !detail.triggeredBy) {
        parts.unshift(`Endpoint: ${ep.method} ${(config.endpoints?.basePath || '') + (ep.path || '')}`);
      }
      detail.description = parts.length > 0
        ? parts.join(' ')
        : 'Caso de uso custom — requiere implementación manual del handler.';
      detail.isStandard = false;
    }

    useCaseDetails[ucName] = detail;
  }

  return {
    diagram: lines.join('\n'),
    useCases: useCaseDetails,
  };
}

// ── Group endpoints by resource path ──────────────────────────────────────────

function groupEndpointsByResource(operations, basePath) {
  // Group by resource segment: e.g. /orders/{id}/confirm → "orders"
  // Operations on root path (/ or /{id}) → group "root"
  // Operations on sub-paths (/{id}/confirm) → include action in method label
  const groups = new Map(); // resource → { methods: [], useCases: [] }

  for (const op of operations) {
    const fullPath = (basePath + (op.path || '')).replace(/\/+/g, '/');
    const segments = fullPath.split('/').filter(Boolean);

    // Determine resource key and method label
    let resource = 'root';
    let methodLabel = op.method;

    // If path has action segments beyond /{id} (e.g. /{id}/confirm)
    const actionSegments = segments.filter(
      (s) => !s.startsWith('{') && s !== segments[0]
    );
    if (actionSegments.length > 0) {
      methodLabel = `${op.method}·${actionSegments[actionSegments.length - 1]}`;
    }

    if (!groups.has(resource)) {
      groups.set(resource, { resource, methods: [], useCases: [] });
    }
    const group = groups.get(resource);
    if (!group.methods.includes(methodLabel)) {
      group.methods.push(methodLabel);
    }
    if (op.useCase && !group.useCases.includes(op.useCase)) {
      group.useCases.push(op.useCase);
    }
  }

  return [...groups.values()];
}

// ── Build transition summary for enum ─────────────────────────────────────────

function buildTransitionSummary(en) {
  if (!en.transitions || en.transitions.length === 0) {
    return en.values ? en.values.join(' · ') : '';
  }

  // Build a compact transition map: STATE → STATE, STATE
  // Group by 'from' to show branching
  const fromMap = new Map();
  for (const t of en.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from];
    for (const from of froms) {
      if (!fromMap.has(from)) fromMap.set(from, []);
      fromMap.get(from).push(t.to);
    }
  }

  const parts = [];
  for (const [from, tos] of fromMap) {
    parts.push(`${from} → ${tos.join(', ')}`);
  }

  return parts.join('\\n');
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function styleSubgraph(subgraphId, color) {
  return [
    `  style ${subgraphId} fill:${color.bg},stroke:${color.border},stroke-width:2px,color:${color.text}`,
  ];
}

module.exports = { generateBlueprintDiagrams };
