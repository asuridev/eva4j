'use strict';

const { pluralizeWord, singularizeWord, toPascalCase } = require('./naming');

/**
 * Domain-level validator for eva evaluate system --domain
 *
 * Receives:
 *   domainConfigs  — Map<moduleName, parsedDomainYaml>
 *   systemConfig   — parsed system.yaml
 *
 * Returns: { summary, categories[], diagrams }
 *
 * Categories:
 *   C1 — Kafka Event Contracts
 *   C2 — Behavior Gaps
 *   C3 — Cross-Reference Integrity
 *   C4 — Audit & Traceability
 *   C5 — Temporal Workflow Integrity
 */

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Returns true when the target name looks like an external service (not a local module). */
function isExternalService(targetName, baseUrl) {
  if (!targetName) return false;
  if (/-external$/i.test(targetName)) return true;
  if (baseUrl && /^https?:\/\//i.test(baseUrl) && !/localhost/i.test(baseUrl)) return true;
  return false;
}

/**
 * Split a PascalCase or camelCase identifier into lowercase words (length > 2).
 * "confirmPayment" → ["confirm", "payment"]
 * "ReserveOrderStock" → ["reserve", "order", "stock"]
 */
function extractWords(name) {
  if (!name) return [];
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((w) => w.length > 2);
}

/**
 * Stem-aware word overlap: returns true if any word in wordsA is a prefix (or equal) to
 * any word in wordsB, and vice-versa — so "ship" matches "shipment".
 */
function wordsOverlap(wordsA, wordsB) {
  for (const a of wordsA) {
    for (const b of wordsB) {
      if (a.startsWith(b) || b.startsWith(a)) return true;
      // Shared-prefix matching: "reservation" ↔ "reserve" share "reser" (5+ chars)
      const minLen = Math.min(a.length, b.length);
      if (minLen >= 5 && a.substring(0, 5) === b.substring(0, 5)) return true;
    }
  }
  return false;
}

/**
 * Fuzzy field-name matching for C4-004: checks exact match, then suffix match.
 * e.g. "cancellationReason" matches event field "reason" (suffix),
 *      "failureReason" matches "reason" (suffix).
 */
function fieldMatchesAnyEventField(fieldName, eventFieldNames) {
  if (eventFieldNames.has(fieldName)) return true;
  const lower = fieldName.toLowerCase();
  for (const ef of eventFieldNames) {
    const efLower = ef.toLowerCase();
    if (lower.endsWith(efLower) && efLower.length >= 3) return true;
    if (efLower.endsWith(lower) && lower.length >= 3) return true;
  }
  return false;
}

/** Critical module heuristic */
function isCriticalModule(name) {
  return /payment|billing|order|reservation|customer|user|inventory/i.test(name);
}

/** Normalize a URL path for comparison: lowercase, trim trailing slash, replace {param} with {x} */
function pathNormalize(p) {
  if (!p) return '';
  return p
    .toLowerCase()
    .replace(/\/$/, '')
    .replace(/\{[^}]+\}/g, '{x}')
    .trim();
}

/**
 * Build map:  eventName → { moduleName, fields: [{name, type}] }
 * from domain aggregates[].events[]
 */
function buildProducedEvents(domainConfigs) {
  const map = {};
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
        map[ev.name] = {
          moduleName,
          fields: ev.fields || [],
        };
      }
    }
  }
  return map;
}

/**
 * Build map:  eventName → { producer, topic, consumers: string[] }
 * from system.yaml integrations.async[]
 */
function buildSystemAsyncMap(systemConfig) {
  const map = {};
  for (const ev of (systemConfig.integrations || {}).async || []) {
    map[ev.event] = {
      producer: ev.producer,
      topic: ev.topic,
      consumers: (ev.consumers || []).map((c) => {
        if (typeof c === 'string') return { module: c, useCase: undefined, readModel: undefined };
        return { module: c.module, useCase: c.useCase, readModel: c.readModel };
      }),
    };
  }
  return map;
}

/**
 * Returns all declared endpoint strings "METHOD /path" for a module,
 * combining domain.yaml endpoints + system.yaml exposes[].
 */
function getAllEndpoints(moduleName, domainConfig, systemConfig) {
  const result = new Set();

  // domain.yaml endpoints section
  if (domainConfig) {
    const ep = domainConfig.endpoints;
    if (ep) {
      for (const ver of ep.versions || []) {
        for (const op of ver.operations || []) {
          result.add(`${(op.method || '').toUpperCase()} ${op.path || ''}`);
        }
      }
    }
  }

  // system.yaml exposes
  const sysMod = (systemConfig.modules || []).find((m) => m.name === moduleName);
  if (sysMod) {
    for (const ep of sysMod.exposes || []) {
      result.add(`${(ep.method || '').toUpperCase()} ${ep.path || ''}`);
    }
  }

  return [...result];
}

/**
 * Normalize a type string for comparison: strip whitespace, lowercase,
 * treat List<X> as "list<x>".
 */
function normalizeType(t) {
  if (!t) return '';
  return t.toLowerCase().replace(/\s+/g, '');
}

/**
 * Returns true when two type strings are considered compatible.
 * Handles common aliases (Integer/int, Long/long, etc.) and List variants.
 */
function typesCompatible(a, b) {
  const na = normalizeType(a);
  const nb = normalizeType(b);
  if (na === nb) return true;

  const aliases = {
    integer: ['int', 'integer'],
    long: ['long'],
    double: ['double', 'float'],
    boolean: ['boolean', 'bool'],
    string: ['string'],
    bigdecimal: ['bigdecimal', 'decimal'],
    localdate: ['localdate'],
    localdatetime: ['localdatetime'],
    localtime: ['localtime'],
    instant: ['instant'],
    uuid: ['uuid'],
  };

  for (const group of Object.values(aliases)) {
    if (group.includes(na) && group.includes(nb)) return true;
  }
  return false;
}

// ── Finding builders ─────────────────────────────────────────────────────────

function finding(module, message, context) {
  return { module, message, context: context || '' };
}

// ── Check runners ────────────────────────────────────────────────────────────

// ─── C1 — Kafka Event Contracts ─────────────────────────────────────────────

function runC1(domainConfigs, systemConfig) {
  const producedEvents = buildProducedEvents(domainConfigs);
  const systemAsyncMap = buildSystemAsyncMap(systemConfig);
  const allModuleNames = new Set(Object.keys(domainConfigs));

  const checks = {
    'C1-001': { label: 'Evento producido sin consumidor en system.yaml', severity: 'ok', findings: [] },
    'C1-002': { label: 'Listener referencia evento que ningún módulo produce', severity: 'ok', findings: [] },
    'C1-003': { label: 'Campo en listener.fields no existe en el evento del productor', severity: 'ok', findings: [] },
    'C1-004': { label: 'Campo existe pero con tipo incompatible productor/consumidor', severity: 'ok', findings: [] },
    'C1-005': { label: 'system.yaml registra consumidor pero módulo no tiene listener o readModel.syncedBy declarado', severity: 'ok', findings: [] },
    'C1-006': { label: 'Listener declara producer: incorrecto', severity: 'ok', findings: [] },
    'C1-007': { label: 'Campo de readModel no cubierto por eventos UPSERT del productor', severity: 'ok', findings: [] },
  };

  // C1-001: produced event in domain but zero consumers in system.yaml
  for (const [eventName, info] of Object.entries(producedEvents)) {
    const sysEntry = systemAsyncMap[eventName];
    if (!sysEntry || sysEntry.consumers.length === 0) {
      checks['C1-001'].findings.push(
        finding(info.moduleName, `El evento '${eventName}' no tiene consumidores registrados en system.yaml`, `Producido por: ${info.moduleName}`)
      );
    }
  }

  // C1-002: listener references event that no domain produces
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const listener of config.listeners || []) {
      if (!producedEvents[listener.event]) {
        checks['C1-002'].findings.push(
          finding(moduleName, `Listener de '${listener.event}' pero ningún módulo en los domain.yaml lo produce`, `Declarado producer: ${listener.producer}`)
        );
      }
    }
  }

  // C1-003 & C1-004: field-level contract comparison
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const listener of config.listeners || []) {
      const producerInfo = producedEvents[listener.event];
      if (!producerInfo) continue; // already caught by C1-002

      const producerFieldMap = {};
      for (const f of producerInfo.fields) {
        producerFieldMap[f.name] = f.type;
      }

      for (const lf of listener.fields || []) {
        // Skip List<NestedType> fields — nestedTypes differ structurally
        if (/^list</i.test((lf.type || '').replace(/\s/g, ''))) continue;

        if (!(lf.name in producerFieldMap)) {
          checks['C1-003'].findings.push(
            finding(
              moduleName,
              `Campo '${lf.name}' en listener de '${listener.event}' no existe en los campos del evento del productor (${producerInfo.moduleName})`,
              `Tipo esperado: ${lf.type}`
            )
          );
        } else {
          const producerType = producerFieldMap[lf.name];
          if (!typesCompatible(lf.type, producerType)) {
            checks['C1-004'].findings.push(
              finding(
                moduleName,
                `Campo '${lf.name}' en listener de '${listener.event}': tipo incompatible`,
                `Productor declara '${producerType}', listener declara '${lf.type}'`
              )
            );
          }
        }
      }
    }
  }

  // C1-005: system.yaml consumer present but module has no listener or readModel.syncedBy
  for (const [eventName, sysEntry] of Object.entries(systemAsyncMap)) {
    for (const consumer of sysEntry.consumers) {
      const consumerConfig = domainConfigs[consumer.module];
      if (!consumerConfig) continue; // module domain.yaml not loaded — skip

      if (consumer.readModel) {
        // readModel consumer → check readModels[].syncedBy[]
        const hasSync = (consumerConfig.readModels || []).some((rm) =>
          (rm.syncedBy || []).some((s) => s.event === eventName)
        );
        if (!hasSync) {
          checks['C1-005'].findings.push(
            finding(
              consumer.module,
              `system.yaml registra '${consumer.module}' como consumidor readModel de '${eventName}' pero el módulo no tiene readModels[].syncedBy con ese evento`,
              `Evento producido por: ${sysEntry.producer}, readModel esperado: ${consumer.readModel}`
            )
          );
        }
      } else {
        // useCase consumer → check listeners[]
        const hasListener = (consumerConfig.listeners || []).some((l) => l.event === eventName);
        if (!hasListener) {
          checks['C1-005'].findings.push(
            finding(
              consumer.module,
              `system.yaml registra '${consumer.module}' como consumidor de '${eventName}' pero el módulo no tiene listener declarado`,
              `Evento producido por: ${sysEntry.producer}`
            )
          );
        }
      }
    }
  }

  // C1-006: listener.producer doesn't match the actual producer
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const listener of config.listeners || []) {
      const producerInfo = producedEvents[listener.event];
      if (!producerInfo) continue; // caught by C1-002
      if (listener.producer && listener.producer !== producerInfo.moduleName) {
        checks['C1-006'].findings.push(
          finding(
            moduleName,
            `Listener declara producer: '${listener.producer}' pero '${listener.event}' es producido por '${producerInfo.moduleName}'`,
            `Evento: ${listener.event}`
          )
        );
      }
    }
  }

  // C1-007: readModel field not covered by any UPSERT event from producer (RM-008)
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const rm of config.readModels || []) {
      // Collect field names from all UPSERT syncedBy events
      const upsertEventFields = new Set();
      for (const sync of rm.syncedBy || []) {
        if ((sync.action || '').toUpperCase() !== 'UPSERT') continue;
        const producerInfo = producedEvents[sync.event];
        if (!producerInfo) continue; // caught by other checks
        for (const f of producerInfo.fields) {
          upsertEventFields.add(f.name);
        }
      }
      // Check each readModel field (except 'id') is covered
      for (const rmField of rm.fields || []) {
        if (rmField.name === 'id') continue; // mapped to {entityName}Id in events
        if (!upsertEventFields.has(rmField.name)) {
          checks['C1-007'].findings.push(
            finding(
              moduleName,
              `ReadModel '${rm.name}' tiene campo '${rmField.name}' que no aparece en ningún evento UPSERT de syncedBy`,
              `Source: ${rm.source ? rm.source.module : '?'}. El campo siempre será null — agregar a los events del productor o quitar del readModel`
            )
          );
        }
      }
    }
  }

  // Assign severities
  setDefaultSeverities(checks, {
    'C1-001': 'info',
    'C1-002': 'error',
    'C1-003': 'error',
    'C1-004': 'error',
    'C1-005': 'error',
    'C1-006': 'error',
    'C1-007': 'warning',
  });

  return checks;
}

// ─── C2 — Behavior Gaps ─────────────────────────────────────────────────────

function runC2(domainConfigs, systemConfig) {
  const checks = {
    'C2-001': { label: 'Transición de estado sin endpoint HTTP ni listener asociado', severity: 'ok', findings: [] },
    'C2-002': { label: 'UseCase de listener sin endpoint REST en módulo que expone REST', severity: 'ok', findings: [] },
    'C2-003': { label: 'Valor en enum *Type sin evento Kafka trazable que lo origine', severity: 'ok', findings: [] },
    'C2-004': { label: 'Trigger de evento referencia método de transición inexistente', severity: 'ok', findings: [] },
    'C2-005': { label: 'Transición de estado sin Domain Event asociado (sin trigger)', severity: 'ok', findings: [] },
    'C2-006': { label: 'Colisión de nombre de useCase entre endpoints y listeners', severity: 'ok', findings: [] },
    'C2-007': { label: 'UseCase FindAll con nombre de agregado sin pluralizar correctamente', severity: 'ok', findings: [] },
    'C2-008': { label: 'Evento con valor de lifecycle inválido', severity: 'ok', findings: [] },
    'C2-009': { label: 'Evento lifecycle incompatible con configuración de entidad', severity: 'ok', findings: [] },
    'C2-010': { label: 'Campo de lifecycle event no existe en la entidad raíz', severity: 'ok', findings: [] },
    'C2-011': { label: 'Endpoint useCase no se resuelve a ningún agregado del módulo', severity: 'ok', findings: [] },
    'C2-012': { label: 'Nombre del agregado no coincide con la entidad raíz (causa import incorrecto en ApplicationMapper)', severity: 'ok', findings: [] },
    'C2-013': { label: 'useCase duplicado entre listeners del mismo módulo (falla UseCaseAutoRegister en runtime)', severity: 'ok', findings: [] },
  };

  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    const allEndpoints = getAllEndpoints(moduleName, config, systemConfig);
    const allListenerUseCases = (config.listeners || []).map((l) => l.useCase || '');

    // Collect all useCases exposed
    const endpointUseCases = new Set();
    for (const ep of allEndpoints) {
      // ep = "METHOD /path" — we don't have useCase here from system.yaml
    }

    // Collect useCases from domain.yaml endpoints section
    const domainEndpointUseCases = new Set();
    if (config.endpoints) {
      for (const ver of config.endpoints.versions || []) {
        for (const op of ver.operations || []) {
          if (op.useCase) domainEndpointUseCases.add(op.useCase);
        }
      }
    }
    // From system.yaml exposes
    const sysMod = (systemConfig.modules || []).find((m) => m.name === moduleName);
    const sysUseCases = new Set();
    if (sysMod) {
      for (const ep of sysMod.exposes || []) {
        if (ep.useCase) sysUseCases.add(ep.useCase);
      }
    }
    const allKnownUseCases = new Set([...domainEndpointUseCases, ...sysUseCases]);
    const allListenerUCSet = new Set(allListenerUseCases.filter(Boolean));

    // Collect transition methods covered by event triggers — used to relax C2-001 and populate C2-005
    const triggeredMethods = new Set();
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
        for (const trigger of ev.triggers || []) {
          triggeredMethods.add(trigger);
        }
      }
    }

    // C2-001: transition method has no matching endpoint nor listener
    // Silenced when the method already has an event trigger (design evidence).
    for (const agg of config.aggregates || []) {
      for (const en of agg.enums || []) {
        for (const tr of en.transitions || []) {
          const methodName = tr.method;
          if (!methodName) continue;

          const methodWords = extractWords(methodName);
          // Match against all known useCases (endpoints + listeners)
          const allUCWords = [...allKnownUseCases, ...allListenerUCSet];
          const matched = allUCWords.some((uc) => wordsOverlap(methodWords, extractWords(uc)));

          if (!matched && !triggeredMethods.has(methodName)) {
            checks['C2-001'].findings.push(
              finding(
                moduleName,
                `Transición '${methodName}' de ${en.name} (${tr.from} → ${tr.to}) no tiene endpoint HTTP ni listener asociado`,
                `Agregado: ${agg.name}, Enum: ${en.name}. Nota: puede invocarse internamente desde otro use case del módulo`
              )
            );
          }
        }
      }
    }

    // C2-004: event trigger references a method that does not exist in any transition
    // Skipped for events that use lifecycle: instead of triggers:
    const allTransitionMethods = new Set();
    for (const agg of config.aggregates || []) {
      for (const en of agg.enums || []) {
        for (const tr of en.transitions || []) {
          if (tr.method) allTransitionMethods.add(tr.method);
        }
      }
    }
    for (const agg of config.aggregates || []) {
      // Skip C2-004 for aggregates that have no enums — stateless entities have no transition
      // methods, so event triggers on creation/registration cannot reference any method.
      const aggHasEnumsWithTransitions = (agg.enums || []).some(
        (en) => Array.isArray(en.transitions) && en.transitions.length > 0
      );
      for (const ev of agg.events || []) {
        if (ev.lifecycle) continue; // lifecycle events don't reference transition methods
        if (!aggHasEnumsWithTransitions) continue; // stateless aggregate — no transitions to reference
        for (const trigger of ev.triggers || []) {
          if (!allTransitionMethods.has(trigger)) {
            checks['C2-004'].findings.push(
              finding(
                moduleName,
                `Evento '${ev.name}' tiene trigger '${trigger}' que no corresponde a ningún método de transición`,
                `Métodos disponibles: ${[...allTransitionMethods].join(', ') || '(ninguno)'}`
              )
            );
          }
        }
      }
    }

    // C2-008: event lifecycle value is not one of the valid options
    const validLifecycleValues = ['create', 'update', 'delete', 'softDelete'];
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
        if (ev.lifecycle && !validLifecycleValues.includes(ev.lifecycle)) {
          checks['C2-008'].findings.push(
            finding(
              moduleName,
              `Evento '${ev.name}' tiene lifecycle: '${ev.lifecycle}' que no es un valor válido`,
              `Valores válidos: ${validLifecycleValues.join(', ')}`
            )
          );
        }
      }
    }

    // C2-009: lifecycle value is incompatible with entity configuration
    for (const agg of config.aggregates || []) {
      const rootEntity = (agg.entities || []).find(e => e.isRoot);
      const hasSoftDelete = rootEntity && rootEntity.hasSoftDelete;
      for (const ev of agg.events || []) {
        if (ev.lifecycle === 'softDelete' && !hasSoftDelete) {
          checks['C2-009'].findings.push(
            finding(
              moduleName,
              `Evento '${ev.name}' tiene lifecycle: 'softDelete' pero la entidad raíz '${rootEntity ? rootEntity.name : agg.name}' no tiene hasSoftDelete: true`,
              `Agregado: ${agg.name}. Agregar hasSoftDelete: true a la entidad raíz o cambiar lifecycle a 'delete'`
            )
          );
        }
        if (ev.lifecycle === 'delete' && hasSoftDelete) {
          checks['C2-009'].findings.push(
            finding(
              moduleName,
              `Evento '${ev.name}' tiene lifecycle: 'delete' pero la entidad raíz '${rootEntity.name}' tiene hasSoftDelete: true`,
              `Agregado: ${agg.name}. Usar lifecycle: 'softDelete' en su lugar o quitar hasSoftDelete`
            )
          );
        }
      }
    }

    // C2-010: lifecycle event field not found in root entity
    for (const agg of config.aggregates || []) {
      const rootEntityC10 = (agg.entities || []).find(e => e.isRoot);
      if (!rootEntityC10) continue;
      const entityFieldNames = new Set((rootEntityC10.fields || []).map(f => f.name));
      const entityBase = rootEntityC10.name.charAt(0).toLowerCase() + rootEntityC10.name.slice(1);
      for (const ev of agg.events || []) {
        if (!ev.lifecycle) continue;
        for (const ef of ev.fields || []) {
          // Skip {entityName}Id — mapped to aggregateId in DomainEvent
          if (ef.name === entityBase + 'Id') continue;
          // Skip temporal auto-resolved fields (*At + LocalDateTime)
          if (ef.name.endsWith('At') && ef.type === 'LocalDateTime') continue;
          if (!entityFieldNames.has(ef.name)) {
            checks['C2-010'].findings.push(
              finding(
                moduleName,
                `Evento '${ev.name}' (lifecycle: ${ev.lifecycle}) tiene campo '${ef.name}' que no existe en la entidad raíz '${rootEntityC10.name}'`,
                `Agregado: ${agg.name}. Quitar '${ef.name}' del evento o agregar el campo a la entidad`
              )
            );
          }
        }
      }
    }

    // C2-005: transition method without any associated domain event trigger
    for (const agg of config.aggregates || []) {
      for (const en of agg.enums || []) {
        for (const tr of en.transitions || []) {
          if (tr.method && !triggeredMethods.has(tr.method)) {
            checks['C2-005'].findings.push(
              finding(
                moduleName,
                `Transición '${tr.method}' (${en.name}: ${tr.from} → ${tr.to}) no tiene ningún Domain Event asociado`,
                `Considerar declarar un evento con triggers: [${tr.method}]`
              )
            );
          }
        }
      }
    }

    // C2-002: listener useCase has no corresponding REST endpoint (info level)
    const hasRestEndpoints = allEndpoints.length > 0;
    if (hasRestEndpoints) {
      for (const listener of config.listeners || []) {
        const uc = listener.useCase;
        if (!uc) continue;
        if (!allKnownUseCases.has(uc)) {
          checks['C2-002'].findings.push(
            finding(
              moduleName,
              `UseCase '${uc}' (listener de '${listener.event}') no tiene endpoint REST equivalente`,
              `El módulo expone REST pero este useCase solo se activa vía evento`
            )
          );
        }
      }
    }

    // C2-003: value in a *Type enum with no traceable event in the module
    // Collect all event field types and event names in this module
    const moduleEventTokens = new Set();
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
        for (const w of extractWords(ev.name)) moduleEventTokens.add(w);
        for (const f of ev.fields || []) {
          if (f.type && /^[A-Z]/.test(f.type)) {
            for (const w of extractWords(f.type)) moduleEventTokens.add(w);
          }
        }
      }
    }
    // Also include listener event names, field names, and useCase names as traceable origins.
    // Field names cover cases like wasLateReturn → [late, return] tracing LATE_RETURN,
    // where the semantic connection is in a boolean field name, not the event name itself.
    // UseCase names cover cases like ReserveStock → [reserve, stock] tracing RESERVATION,
    // where the enum value originates from a listener-triggered use case.
    for (const listener of config.listeners || []) {
      for (const w of extractWords(listener.event)) moduleEventTokens.add(w);
      for (const w of extractWords(listener.useCase || '')) moduleEventTokens.add(w);
      for (const f of listener.fields || []) {
        for (const w of extractWords(f.name)) moduleEventTokens.add(w);
      }
    }
    // Also include endpoint useCase names as traceable origins.
    // Values like DAMAGE_REPORT originate from an HTTP action (e.g. RegisterIncident),
    // not from a Kafka event — the useCase name provides the semantic trace.
    const epSection = config.endpoints;
    for (const ver of (epSection && epSection.versions) || []) {
      for (const op of ver.operations || []) {
        for (const w of extractWords(op.useCase || '')) moduleEventTokens.add(w);
      }
    }

    for (const agg of config.aggregates || []) {
      for (const en of agg.enums || []) {
        if (!en.name.endsWith('Type')) continue;
        for (const val of en.values || []) {
          const valWords = extractWords(val);
          const traceable = valWords.some((w) => moduleEventTokens.has(w))
            || valWords.some((w) => [...moduleEventTokens].some((t) => wordsOverlap([w], [t])));
          if (!traceable) {
            checks['C2-003'].findings.push(
              finding(
                moduleName,
                `Valor '${val}' en ${en.name} no tiene mecanismo trazable que lo origine (ni evento Kafka ni endpoint HTTP)`,
                `Enum: ${en.name} en agregado ${agg.name}`
              )
            );
          }
        }
      }
    }

    // C2-013: duplicate useCase across listeners within the same module
    // UseCaseAutoRegister.getGenericType() only registers the FIRST CommandHandler<X> it finds.
    // If multiple listeners share the same useCase, only one Command type gets registered;
    // dispatching any other type causes IllegalArgumentException at runtime.
    const listenerUseCaseMap = {};
    for (const listener of config.listeners || []) {
      const uc = listener.useCase;
      if (!uc) continue;
      if (!listenerUseCaseMap[uc]) listenerUseCaseMap[uc] = [];
      listenerUseCaseMap[uc].push(listener.event || '(sin event)');
    }
    for (const [uc, events] of Object.entries(listenerUseCaseMap)) {
      if (events.length < 2) continue;
      checks['C2-013'].findings.push(
        finding(
          moduleName,
          `useCase '${uc}' está declarado en ${events.length} listeners: ${events.join(', ')}`,
          `UseCaseAutoRegister solo registra un tipo genérico por handler — usa useCase: distintos en cada listener (ej: Notify${uc.replace(/^Notify/, '')}OnX, Notify${uc.replace(/^Notify/, '')}OnY).`
        )
      );
    }

    // C2-006: useCase name collision between endpoints and listeners
    // Endpoints generate "{UseCase}Command.java". Listeners with no explicit command: also use
    // "{UseCase}Command.java". With explicit command: the listener uses a different class name,
    // so a collision only happens when the listener has no command: override.
    const domainEpUseCases = new Set();
    for (const ver of (config.endpoints && config.endpoints.versions) || []) {
      for (const op of ver.operations || []) {
        if (op.useCase) domainEpUseCases.add(op.useCase);
      }
    }
    for (const listener of config.listeners || []) {
      const uc = listener.useCase;
      // Only flag collision if the listener has NO explicit command: (i.e. commandClassName === useCaseName + 'Command')
      const hasExplicitCommand = !!listener.command;
      if (uc && !hasExplicitCommand && domainEpUseCases.has(uc)) {
        checks['C2-006'].findings.push(
          finding(
            moduleName,
            `UseCase '${uc}' está declarado en endpoints: y en listeners: (evento '${listener.event}')`,
            `Ambos generan '${uc}Command.java' — el endpoint sobreescribe el comando del listener. Añade command: <NombreExplícito> al listener, o renombra el useCase del listener.`
          )
        );
      }
    }

    // C2-007: FindAll use case name must use proper English plural of the aggregate
    for (const agg of config.aggregates || []) {
      const aggName = agg.name;
      const expectedPlural = pluralizeWord(aggName);
      const expectedFindAll = `FindAll${expectedPlural}`;

      for (const ver of (config.endpoints && config.endpoints.versions) || []) {
        for (const op of ver.operations || []) {
          const uc = op.useCase || '';
          if (!uc.startsWith('FindAll')) continue;
          const suffix = uc.slice(7); // after 'FindAll'
          // Match singular name or naive 's' suffix targeting this aggregate
          if (suffix === aggName || suffix === `${aggName}s`) {
            if (uc !== expectedFindAll) {
              checks['C2-007'].findings.push(
                finding(
                  moduleName,
                  `UseCase '${uc}' debería ser '${expectedFindAll}' (plural correcto de '${aggName}')`,
                  `Agregado: ${aggName}, versión: ${ver.version}. Sin el plural correcto, el generador creará un scaffold en lugar de la implementación estándar paginada.`
                )
              );
            }
          }
        }
      }
    }

    // C2-011: Endpoint useCase not semantically resolvable to any aggregate
    // Detects FindAll/Get use cases that won't match any aggregate via exact
    // or fuzzy matching — these silently fall to scaffold with the wrong
    // aggregate's ResponseDto, producing code that doesn't compile.
    const allAggs = config.aggregates || [];
    for (const ver of (config.endpoints && config.endpoints.versions) || []) {
      for (const op of ver.operations || []) {
        const uc = op.useCase || '';
        let resolved = false;

        for (const agg of allAggs) {
          const aggName = agg.name;
          const aggPlural = pluralizeWord(aggName);
          // Exact standard match
          if (uc === `Create${aggName}` || uc === `Update${aggName}` ||
              uc === `Delete${aggName}` || uc === `Get${aggName}` ||
              uc === `FindAll${aggPlural}`) {
            resolved = true;
            break;
          }
          // Fuzzy FindAll: singular of suffix is prefix of aggregate name (or vice-versa)
          if (uc.startsWith('FindAll')) {
            const suffix = uc.slice(7);
            if (suffix) {
              const singular = singularizeWord(suffix).toLowerCase();
              const aggLower = aggName.toLowerCase();
              if (aggLower.startsWith(singular) || singular.startsWith(aggLower)) {
                resolved = true;
                break;
              }
            }
          }
          // Fuzzy Get: suffix is prefix of aggregate name (or vice-versa)
          if (uc.startsWith('Get') && !uc.startsWith('GetAll')) {
            const suffix = uc.slice(3);
            if (suffix) {
              const suffixLower = suffix.toLowerCase();
              const aggLower = aggName.toLowerCase();
              if (aggLower.startsWith(suffixLower) || suffixLower.startsWith(aggLower)) {
                resolved = true;
                break;
              }
            }
          }
          // Transition match
          const entities = agg.entities || [];
          const rootEntity = entities.find(e => e.isRoot) || entities[0] || {};
          const enums = rootEntity.enums || agg.enums || [];
          for (const enumDef of enums) {
            for (const tr of (enumDef.transitions || [])) {
              const methodPascal = tr.method.charAt(0).toUpperCase() + tr.method.slice(1);
              if (uc === `${methodPascal}${aggName}`) {
                resolved = true;
              }
            }
          }
          if (resolved) break;
          // SubEntity match
          const rels = (rootEntity.relationships || []).filter(r => r.type === 'OneToMany' && !r.isInverse);
          for (const rel of rels) {
            if (uc === `Add${rel.target}` || uc === `Remove${rel.target}`) {
              resolved = true;
              break;
            }
          }
          if (resolved) break;
          // Substring fallback: aggregate name inside useCase
          if (uc.toLowerCase().includes(aggName.toLowerCase())) {
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          const firstAgg = allAggs.length > 0 ? allAggs[0].name : '(none)';
          checks['C2-011'].findings.push(
            finding(
              moduleName,
              `UseCase '${uc}' no se resuelve a ningún agregado del módulo — se asignará al primero ('${firstAgg}') y generará código con tipos incorrectos`,
              `Versión: ${ver.version}. Considere renombrar el useCase para que contenga el nombre del agregado, o verificar que el agregado destino existe.`
            )
          );
        }
      }
    }
  }

  // C2-012: Aggregate name ≠ root entity name → ApplicationMapper imports wrong class
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const agg of config.aggregates || []) {
      const rootEntity = (agg.entities || []).find(e => e.isRoot);
      if (rootEntity && toPascalCase(rootEntity.name) !== agg.name) {
        checks['C2-012'].findings.push(
          finding(
            moduleName,
            `Agregado '${agg.name}' tiene entidad raíz '${rootEntity.name}' (PascalCase: '${toPascalCase(rootEntity.name)}') — los nombres no coinciden. El generador usará '${agg.name}' para imports y mappers pero la clase de dominio se llamará '${toPascalCase(rootEntity.name)}'`,
            `Renombre la entidad raíz a '${agg.name.charAt(0).toLowerCase() + agg.name.slice(1)}' o el agregado a '${toPascalCase(rootEntity.name)}' para que coincidan.`
          )
        );
      }
    }
  }

  setDefaultSeverities(checks, {
    'C2-001': 'warning',
    'C2-002': 'info',
    'C2-003': 'warning',
    'C2-004': 'error',
    'C2-005': 'info',
    'C2-006': 'error',
    'C2-007': 'error',
    'C2-008': 'error',
    'C2-009': 'warning',
    'C2-010': 'error',
    'C2-011': 'error',
    'C2-012': 'error',
    'C2-013': 'error',
  });

  return checks;
}

// ─── C3 — Cross-Reference Integrity ─────────────────────────────────────────

function runC3(domainConfigs, systemConfig) {
  const checks = {
    'C3-001': { label: 'Campo con reference.module=X sin port ni listener hacia X', severity: 'ok', findings: [] },
    'C3-002': { label: 'Port apunta a módulo interno inexistente en domain.yaml', severity: 'ok', findings: [] },
    'C3-003': { label: 'Port llama endpoint no declarado en módulo destino', severity: 'ok', findings: [] },
    'C3-004': { label: 'Dependencia síncrona a módulo que no emite eventos Kafka', severity: 'ok', findings: [] },
    'C3-005': { label: 'Acoplamiento síncrono bidireccional entre dos módulos', severity: 'ok', findings: [] },
    'C3-006': { label: 'system.yaml declara llamada síncrona pero módulo no tiene port correspondiente', severity: 'ok', findings: [] },
    'C3-007': { label: 'Colisión de bean CommandHandler/QueryHandler entre módulos (mismo useCase)', severity: 'ok', findings: [] },
  };

  const internalModuleNames = new Set(Object.keys(domainConfigs));
  const sysModuleNames = new Set((systemConfig.modules || []).map((m) => m.name));

  // Build sync caller→callees map from domain ports
  const domainSyncCallers = {}; // moduleName → Set<targetModule>
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    domainSyncCallers[moduleName] = new Set();
    for (const port of config.ports || []) {
      if (!isExternalService(port.target, port.baseUrl)) {
        domainSyncCallers[moduleName].add(port.target);
      }
    }
  }

  // Build sync caller→callees from system.yaml integrations.sync
  const sysSyncCallers = {}; // moduleName → Set<targetModule>
  for (const sync of (systemConfig.integrations || {}).sync || []) {
    if (!sysSyncCallers[sync.caller]) sysSyncCallers[sync.caller] = new Set();
    sysSyncCallers[sync.caller].add(sync.calls);
  }

  // Modules that produce events
  const eventProducers = new Set();
  for (const ev of (systemConfig.integrations || {}).async || []) {
    eventProducers.add(ev.producer);
  }

  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    // C3-001: field with reference.module=X but no port[].target=X and no listener[].producer=X
    for (const agg of config.aggregates || []) {
      for (const entity of agg.entities || []) {
        for (const field of entity.fields || []) {
          const ref = field.reference;
          if (!ref || !ref.module) continue;
          if (ref.module === moduleName) continue; // same module — fine

          const hasPort = (config.ports || []).some((p) => p.target === ref.module);
          const hasListener = (config.listeners || []).some((l) => l.producer === ref.module);
          if (!hasPort && !hasListener) {
            checks['C3-001'].findings.push(
              finding(
                moduleName,
                `Campo '${field.name}' referencia módulo '${ref.module}' pero no hay port ni listener que conecte con ese módulo`,
                `Entidad: ${entity.name}, Ref aggregate: ${ref.aggregate || '?'}`
              )
            );
          }
        }
      }
    }

    // C3-002: port.target is a known internal module but no domain.yaml was found for it
    for (const port of config.ports || []) {
      const target = port.target;
      if (isExternalService(target, port.baseUrl)) continue;
      if (sysModuleNames.has(target) && !internalModuleNames.has(target)) {
        checks['C3-002'].findings.push(
          finding(
            moduleName,
            `Port '${port.service}' apunta a '${target}' que está en system.yaml pero no tiene domain.yaml cargado`,
            `Port: ${port.name || port.service}`
          )
        );
      }
    }

    // C3-003: port method calls an endpoint not declared in the target module
    for (const port of config.ports || []) {
      const target = port.target;
      if (isExternalService(target, port.baseUrl)) continue;
      const targetDomain = domainConfigs[target];
      if (!targetDomain && !sysModuleNames.has(target)) continue;

      const targetEndpoints = getAllEndpoints(target, targetDomain || null, systemConfig);
      const normalizedTargetEps = targetEndpoints.map((ep) => {
        const [method, ...pathParts] = ep.split(' ');
        return `${method} ${pathNormalize(pathParts.join(' '))}`;
      });

      // http field format: "METHOD /path"
      if (port.http) {
        const [method, ...pathParts] = port.http.split(' ');
        const normalizedCall = `${method.toUpperCase()} ${pathNormalize(pathParts.join(' '))}`;
        const found = normalizedTargetEps.some((ep) => ep === normalizedCall);
        if (!found && targetEndpoints.length > 0) {
          checks['C3-003'].findings.push(
            finding(
              moduleName,
              `Port '${port.name || port.service}' llama '${port.http}' en '${target}' pero ese endpoint no está declarado en el módulo destino`,
              `Target: ${target}`
            )
          );
        }
      }
    }

    // C3-004: module calls a sync dependency that doesn't emit any Kafka events
    for (const port of config.ports || []) {
      const target = port.target;
      if (isExternalService(target, port.baseUrl)) continue;
      if (!sysModuleNames.has(target)) continue;
      if (!eventProducers.has(target)) {
        checks['C3-004'].findings.push(
          finding(
            moduleName,
            `'${moduleName}' tiene dependencia síncrona con '${target}' pero '${target}' no emite eventos Kafka`,
            `Port: ${port.service}`
          )
        );
      }
    }
  }

  // C3-005: bidirectional sync coupling (A→B and B→A in system.yaml)
  const seenPairs = new Set();
  for (const [callerA, calleesA] of Object.entries(sysSyncCallers)) {
    for (const calleeB of calleesA) {
      if (seenPairs.has(`${calleeB}→${callerA}`)) continue; // keep one direction
      if (sysSyncCallers[calleeB] && sysSyncCallers[calleeB].has(callerA)) {
        checks['C3-005'].findings.push(
          finding(
            callerA,
            `Acoplamiento síncrono bidireccional entre '${callerA}' y '${calleeB}'`,
            `${callerA} llama a ${calleeB} y ${calleeB} llama a ${callerA}`
          )
        );
        seenPairs.add(`${callerA}→${calleeB}`);
      }
    }
  }

  // C3-006: system.yaml sync call but caller module has no matching port
  for (const sync of (systemConfig.integrations || {}).sync || []) {
    const callerConfig = domainConfigs[sync.caller];
    if (!callerConfig) continue;
    const target = sync.calls;
    const hasPort = (callerConfig.ports || []).some((p) => p.target === target);
    if (!hasPort) {
      checks['C3-006'].findings.push(
        finding(
          sync.caller,
          `system.yaml declara que '${sync.caller}' llama síncronamente a '${target}' pero el módulo no tiene port declarado hacia '${target}'`,
          `Port esperado: ${sync.port || target + 'Service'}`
        )
      );
    }
  }

  // C3-007: cross-module useCase name collision → ConflictingBeanDefinitionException
  // Two modules generating a handler with the same simple class name causes Spring bean conflict
  // because UseCaseConfig scans the entire base package and @ApplicationComponent has no qualifier.
  const handlerRegistry = {}; // handlerClassName → [{module, source}]
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    // Collect handler names from listeners
    for (const listener of config.listeners || []) {
      const uc = listener.useCase;
      if (!uc) continue;
      const handlerName = `${uc}CommandHandler`;
      if (!handlerRegistry[handlerName]) handlerRegistry[handlerName] = [];
      handlerRegistry[handlerName].push({ module: moduleName, source: `listener(${listener.event})` });
    }
    // Collect handler names from endpoints
    for (const ver of (config.endpoints && config.endpoints.versions) || []) {
      for (const op of ver.operations || []) {
        if (!op.useCase) continue;
        const resolvedType = op.type || (op.method === 'GET' ? 'query' : 'command');
        const suffix = resolvedType === 'query' ? 'QueryHandler' : 'CommandHandler';
        const handlerName = `${op.useCase}${suffix}`;
        if (!handlerRegistry[handlerName]) handlerRegistry[handlerName] = [];
        handlerRegistry[handlerName].push({ module: moduleName, source: `endpoint(${op.method} ${op.path})` });
      }
    }
  }
  const seenC3007 = new Set();
  for (const [handlerName, entries] of Object.entries(handlerRegistry)) {
    const distinctModules = [...new Set(entries.map((e) => e.module))];
    if (distinctModules.length < 2) continue;
    for (let i = 0; i < distinctModules.length; i++) {
      for (let j = i + 1; j < distinctModules.length; j++) {
        const pair = [distinctModules[i], distinctModules[j]].sort().join('↔');
        const key = `${pair}:${handlerName}`;
        if (seenC3007.has(key)) continue;
        seenC3007.add(key);
        const sourcesA = entries.filter((e) => e.module === distinctModules[i]).map((e) => e.source).join(', ');
        const sourcesB = entries.filter((e) => e.module === distinctModules[j]).map((e) => e.source).join(', ');
        checks['C3-007'].findings.push(
          finding(
            distinctModules[i],
            `'${handlerName}' se genera en '${distinctModules[i]}' y '${distinctModules[j]}' — causa ConflictingBeanDefinitionException`,
            `${distinctModules[i]}: ${sourcesA} | ${distinctModules[j]}: ${sourcesB}. Fix: renombrar el useCase en uno de los módulos con un nombre semántico de su bounded context`
          )
        );
      }
    }
  }

  setDefaultSeverities(checks, {
    'C3-001': 'info',    // reference.module may come from request context (JWT/header) — not always an active integration
    'C3-002': 'error',
    'C3-003': 'warning',
    'C3-004': 'warning',
    'C3-005': 'error',
    'C3-006': 'warning',
    'C3-007': 'error',
  });

  return checks;
}

// ─── C4 — Audit & Traceability ───────────────────────────────────────────────

function runC4(domainConfigs, systemConfig) {
  const checks = {
    'C4-001': { label: 'Entidad hija con cascade REMOVE sin audit ni soft delete (raíz con audit)', severity: 'ok', findings: [] },
    'C4-002': { label: 'Entidad raíz en módulo crítico sin audit.enabled:true', severity: 'ok', findings: [] },
    'C4-003': { label: 'Campo con datos externos tipado como String no estructurado', severity: 'ok', findings: [] },
    'C4-004': { label: 'Campo readOnly en módulo crítico que no aparece en ningún evento', severity: 'ok', findings: [] },
  };

  const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedAt', 'id']);
  const EXTERNAL_DATA_PATTERN = /payload|rawdata|responsedata|externaldata|rawresponse|jsondata/i;

  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    const critical = isCriticalModule(moduleName);

    // Collect all event field names across this module's produced events
    const moduleEventFieldNames = new Set();
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
        for (const f of ev.fields || []) {
          moduleEventFieldNames.add(f.name);
        }
      }
    }

    for (const agg of config.aggregates || []) {
      // Determine if root entity has audit
      const rootEntity = (agg.entities || []).find((e) => e.isRoot);
      const rootHasAudit = rootEntity && rootEntity.audit && rootEntity.audit.enabled;

      // Collect enum names that have transitions — state-machine fields communicate their
      // changes through event names (e.g. PaymentApprovedEvent), not as explicit fields.
      // Excluded from C4-004 to avoid false positives on status fields.
      const stateMachineEnumNames = new Set(
        (agg.enums || [])
          .filter((en) => en.transitions && en.transitions.length > 0)
          .map((en) => en.name)
      );

      for (const entity of agg.entities || []) {
        // C4-001: child entity with cascade REMOVE but no audit and no softDelete
        // Only trigger when root entity has audit.enabled
        if (!entity.isRoot && rootHasAudit) {
          const rels = entity.relationships || [];
          // Also check root relationships pointing at this entity
          for (const parentEntity of agg.entities || []) {
            for (const rel of parentEntity.relationships || []) {
              if (rel.target && rel.target.toLowerCase() === entity.name.toLowerCase()) {
                const hasCascadeRemove = (rel.cascade || []).some(
                  (c) => c === 'REMOVE' || c === 'ALL'
                );
                if (hasCascadeRemove) {
                  const hasAudit = entity.audit && entity.audit.enabled;
                  const hasSoftDelete = entity.hasSoftDelete;
                  if (!hasAudit && !hasSoftDelete) {
                    checks['C4-001'].findings.push(
                      finding(
                        moduleName,
                        `Entidad hija '${entity.name}' tiene cascade REMOVE pero sin audit ni soft delete`,
                        `Raíz '${parentEntity.name}' tiene audit habilitado. Agregado: ${agg.name}`
                      )
                    );
                  }
                }
              }
            }
          }
        }

        for (const field of entity.fields || []) {
          // C6-002: root entity in critical module without audit
          // (Handled per-entity outside loop below, but check root here)
          // noop — done below per entity

          // C4-003: field with external-data-sounding name typed as plain String in a module with ports
          const hasPorts = (config.ports || []).length > 0;
          if (hasPorts && field.type === 'String' && EXTERNAL_DATA_PATTERN.test(field.name)) {
            checks['C4-003'].findings.push(
              finding(
                moduleName,
                `Campo '${field.name}' almacena datos externos como String no estructurado`,
                `Entidad: ${entity.name} — considerar declarar nestedType en su lugar`
              )
            );
          }

          // C4-004: readOnly field in critical module not appearing in any event.
          // Excludes:
          //   - hidden fields (sensitive — not to be propagated in events)
          //   - fields with defaultValue (system constants like currency="USD")
          //   - state-machine fields (type is an enum with transitions — state is communicated
          //     implicitly by the event name, e.g. PaymentApprovedEvent implies status=APPROVED)
          const isSystemConstant = field.defaultValue !== undefined && field.defaultValue !== null;
          const isStateMachineField = stateMachineEnumNames.has(field.type);
          if (critical && entity.isRoot && field.readOnly && !field.hidden && !isSystemConstant && !isStateMachineField && !AUDIT_FIELDS.has(field.name)) {
            if (!fieldMatchesAnyEventField(field.name, moduleEventFieldNames)) {
              checks['C4-004'].findings.push(
                finding(
                  moduleName,
                  `Campo readOnly '${field.name}' en módulo crítico '${moduleName}' no aparece en ningún evento del módulo`,
                  `Entidad: ${entity.name} — considerar incluirlo en un evento o documentar por qué es privado`
                )
              );
            }
          }
        }
      }

      // C4-002: root entity in critical module without audit.enabled
      if (critical && rootEntity && !(rootEntity.audit && rootEntity.audit.enabled)) {
        checks['C4-002'].findings.push(
          finding(
            moduleName,
            `Entidad raíz '${rootEntity.name}' en módulo crítico '${moduleName}' no tiene audit.enabled:true`,
            `Agregado: ${agg.name}`
          )
        );
      }
    }
  }

  setDefaultSeverities(checks, {
    'C4-001': 'warning',
    'C4-002': 'warning',
    'C4-003': 'warning',
    'C4-004': 'warning',
  });

  return checks;
}

// ─── C5 — Temporal Workflow Integrity ────────────────────────────────────────

function runC5(domainConfigs, systemConfig) {
  const checks = {
    'C5-001': { label: 'Tipo de input de actividad de compensación incompatible con actividad padre', severity: 'ok', findings: [] },
    'C5-002': { label: 'Step de workflow referencia actividad no declarada en módulo destino', severity: 'ok', findings: [] },
    'C5-003': { label: 'Compensación de workflow referencia actividad no declarada en módulo destino', severity: 'ok', findings: [] },
    'C5-004': { label: 'Tipo de input en step incompatible con el output del step que lo provee', severity: 'ok', findings: [] },
  };

  const workflows = systemConfig.workflows || [];
  if (workflows.length === 0) return checks;

  // Build map: moduleName → { activityName → activityDef }
  const moduleActivities = {};
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    const acts = {};
    for (const act of config.activities || []) {
      acts[act.name] = act;
    }
    moduleActivities[moduleName] = acts;
  }

  for (const wf of workflows) {
    for (const step of wf.steps || []) {
      const target = step.target;
      const acts = moduleActivities[target] || {};

      // C5-002: activity not found in target module
      if (step.activity && !acts[step.activity]) {
        checks['C5-002'].findings.push(
          finding(
            target,
            `Workflow '${wf.name}' step '${step.activity}' no se encuentra en activities de '${target}'`,
            `Declarar la actividad '${step.activity}' en ${target}.yaml activities[]`
          )
        );
      }

      // C5-003: compensation activity not found in target module
      if (step.compensation && !acts[step.compensation]) {
        checks['C5-003'].findings.push(
          finding(
            target,
            `Workflow '${wf.name}' compensación '${step.compensation}' no se encuentra en activities de '${target}'`,
            `Declarar la actividad '${step.compensation}' en ${target}.yaml activities[]`
          )
        );
      }

      // C5-001: compensation input type mismatch with parent activity
      if (step.activity && step.compensation && acts[step.activity] && acts[step.compensation]) {
        const parentAct = acts[step.activity];
        const compAct = acts[step.compensation];
        const parentInputs = parentAct.input || [];
        const compInputs = compAct.input || [];

        // Compare each input field by position and type
        const maxLen = Math.max(parentInputs.length, compInputs.length);
        for (let i = 0; i < maxLen; i++) {
          const pField = parentInputs[i];
          const cField = compInputs[i];

          if (!pField || !cField) {
            // Different number of input fields
            checks['C5-001'].findings.push(
              finding(
                target,
                `Workflow '${wf.name}': '${step.compensation}' tiene ${compInputs.length} campo(s) de input pero '${step.activity}' tiene ${parentInputs.length}`,
                `La compensación recibe el mismo input que la actividad padre — deben coincidir en cantidad y tipos`
              )
            );
            break; // report once per pair
          }

          const pType = normalizeType(pField.type);
          const cType = normalizeType(cField.type);
          if (pType !== cType && !typesCompatible(pField.type, cField.type)) {
            checks['C5-001'].findings.push(
              finding(
                target,
                `Workflow '${wf.name}': input '${cField.name}' de compensación '${step.compensation}' es '${cField.type}' pero la actividad padre '${step.activity}' usa '${pField.type}'`,
                `Campo '${pField.name}' (pos ${i}). La compensación recibe el mismo input en runtime — usar un tipo neutral compartido (ej: nestedType con los campos mínimos necesarios)`
              )
            );
          }
        }
      }
    }
  }

  // C5-004: workflow data-flow type mismatch
  // Trace variable types through the step chain: each step's output feeds the pool,
  // each subsequent step's input is checked against the pool types.
  for (const wf of workflows) {
    const pool = {}; // varName → { type, producerStep }

    for (const step of wf.steps || []) {
      if (!step.activity) continue; // skip non-activity steps (e.g. wait)
      const target = step.target;
      const acts = moduleActivities[target] || {};
      const actDef = acts[step.activity];
      if (!actDef) continue; // caught by C5-002

      const actInputs = actDef.input || [];
      const stepInputs = step.input || [];

      // Check each step input against pool (positional: step.input[i] → activity.input[i])
      for (let i = 0; i < stepInputs.length && i < actInputs.length; i++) {
        const varName = stepInputs[i];
        const poolEntry = pool[varName];
        if (!poolEntry) continue; // workflow-level param with no prior producer — skip

        const expectedType = actInputs[i].type;
        if (!expectedType) continue;

        const poolType = normalizeType(poolEntry.type);
        const expType = normalizeType(expectedType);
        if (poolType !== expType && !typesCompatible(poolEntry.type, expectedType)) {
          checks['C5-004'].findings.push(
            finding(
              target,
              `Workflow '${wf.name}': step '${step.activity}' espera '${varName}' como '${expectedType}' pero '${poolEntry.producerStep}' lo produce como '${poolEntry.type}'`,
              `Variable '${varName}' fluye de '${poolEntry.producerStep}' → '${step.activity}'. Los tipos deben coincidir — agregar un campo de proyección con el tipo correcto en el output del productor`
            )
          );
        }
      }

      // Register step outputs in pool (positional: step.output[i] → activity.output[i])
      const actOutputs = actDef.output || [];
      const stepOutputs = step.output || [];
      for (let i = 0; i < stepOutputs.length && i < actOutputs.length; i++) {
        pool[stepOutputs[i]] = {
          type: actOutputs[i].type,
          producerStep: step.activity,
        };
      }
    }
  }

  // Also validate domain-level compensation references (activity.compensation within same module)
  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    const acts = moduleActivities[moduleName] || {};
    for (const act of config.activities || []) {
      if (!act.compensation) continue;
      const compAct = acts[act.compensation];

      if (!compAct) {
        // Compensation activity not found — only report if not already caught by C5-003
        const alreadyCaught = checks['C5-003'].findings.some(
          (f) => f.module === moduleName && f.message.includes(`'${act.compensation}'`)
        );
        if (!alreadyCaught) {
          checks['C5-003'].findings.push(
            finding(
              moduleName,
              `Actividad '${act.name}' declara compensation: '${act.compensation}' pero no existe en activities de '${moduleName}'`,
              `Declarar la actividad '${act.compensation}' en ${moduleName}.yaml activities[]`
            )
          );
        }
        continue;
      }

      // Type mismatch check at domain level
      const parentInputs = act.input || [];
      const compInputs = compAct.input || [];
      const maxLen = Math.max(parentInputs.length, compInputs.length);
      for (let i = 0; i < maxLen; i++) {
        const pField = parentInputs[i];
        const cField = compInputs[i];

        if (!pField || !cField) {
          const alreadyCaught = checks['C5-001'].findings.some(
            (f) => f.module === moduleName && f.message.includes(`'${act.compensation}'`) && f.message.includes(`'${act.name}'`)
          );
          if (!alreadyCaught) {
            checks['C5-001'].findings.push(
              finding(
                moduleName,
                `Actividad '${act.compensation}' tiene ${compInputs.length} campo(s) de input pero '${act.name}' tiene ${parentInputs.length}`,
                `La compensación recibe el mismo input que la actividad padre — deben coincidir en cantidad y tipos`
              )
            );
          }
          break;
        }

        const pType = normalizeType(pField.type);
        const cType = normalizeType(cField.type);
        if (pType !== cType && !typesCompatible(pField.type, cField.type)) {
          const alreadyCaught = checks['C5-001'].findings.some(
            (f) => f.module === moduleName && f.message.includes(`'${cField.name}'`) && f.message.includes(`'${act.compensation}'`)
          );
          if (!alreadyCaught) {
            checks['C5-001'].findings.push(
              finding(
                moduleName,
                `Input '${cField.name}' de compensación '${act.compensation}' es '${cField.type}' pero la actividad padre '${act.name}' usa '${pField.type}'`,
                `Campo '${pField.name}' (pos ${i}). La compensación recibe el mismo input en runtime — usar un tipo neutral compartido (ej: nestedType con los campos mínimos necesarios)`
              )
            );
          }
        }
      }
    }
  }

  setDefaultSeverities(checks, {
    'C5-001': 'error',
    'C5-002': 'error',
    'C5-003': 'error',
    'C5-004': 'error',
  });

  return checks;
}

// ── Severity finalization ────────────────────────────────────────────────────

/**
 * For each check: if findings exist set its defaultSeverity, otherwise keep 'ok'.
 */
function setDefaultSeverities(checks, defaults) {
  for (const [id, sev] of Object.entries(defaults)) {
    if (checks[id] && checks[id].findings.length > 0) {
      checks[id].severity = sev;
    }
  }
}

// ─── C6 — ReadModel Integrity ────────────────────────────────────────────────

function runC6(domainConfigs) {
  const checks = {
    'RM-001': { label: 'Nombre de readModel no termina en "ReadModel"', severity: 'ok', findings: [] },
    'RM-002': { label: 'tableName de readModel no comienza con "rm_"', severity: 'ok', findings: [] },
    'RM-004': { label: 'readModel no declara campo "id" en fields', severity: 'ok', findings: [] },
    'RM-005': { label: 'readModel sin ninguna entrada en syncedBy', severity: 'ok', findings: [] },
    'RM-006': { label: 'Acción en syncedBy no es UPSERT, DELETE ni SOFT_DELETE', severity: 'ok', findings: [] },
    'RM-010': { label: 'source.module del readModel es el mismo módulo actual', severity: 'ok', findings: [] },
  };

  const VALID_RM_ACTIONS = new Set(['UPSERT', 'DELETE', 'SOFT_DELETE']);

  for (const [moduleName, config] of Object.entries(domainConfigs)) {
    for (const rm of config.readModels || []) {
      const name = rm.name || '(sin nombre)';

      // RM-001: name must end with 'ReadModel'
      if (!name.endsWith('ReadModel')) {
        checks['RM-001'].findings.push(
          finding(
            moduleName,
            `ReadModel "${name}": el nombre debe terminar con el sufijo "ReadModel"`,
            `Renombrar a "${name}ReadModel" o elegir un nombre que lo incluya`
          )
        );
      }

      // RM-002: tableName must start with 'rm_'
      if (rm.tableName && !rm.tableName.startsWith('rm_')) {
        checks['RM-002'].findings.push(
          finding(
            moduleName,
            `ReadModel "${name}": tableName "${rm.tableName}" debe comenzar con "rm_"`,
            `Cambiar a "rm_${rm.tableName}" para identificación visual en BD`
          )
        );
      }

      // RM-004: fields must include an 'id' field
      const rmFields = rm.fields || [];
      if (!rmFields.some((f) => f.name === 'id')) {
        checks['RM-004'].findings.push(
          finding(
            moduleName,
            `ReadModel "${name}": fields debe incluir un campo "id"`,
            `Agregar { name: id, type: String } como primer campo de fields`
          )
        );
      }

      // RM-005: syncedBy must have at least one entry
      const syncedBy = rm.syncedBy || [];
      if (syncedBy.length === 0) {
        checks['RM-005'].findings.push(
          finding(
            moduleName,
            `ReadModel "${name}": syncedBy debe tener al menos una entrada`,
            `Declarar al menos un evento de sincronización con acción UPSERT, DELETE o SOFT_DELETE`
          )
        );
      }

      // RM-006: action must be valid
      for (const sync of syncedBy) {
        const action = (sync.action || '').toUpperCase();
        if (action && !VALID_RM_ACTIONS.has(action)) {
          checks['RM-006'].findings.push(
            finding(
              moduleName,
              `ReadModel "${name}", evento "${sync.event || '?'}": acción "${sync.action}" no es válida`,
              `Valores válidos: UPSERT, DELETE, SOFT_DELETE`
            )
          );
        }
      }

      // RM-010: source.module must differ from current module
      if (rm.source && rm.source.module) {
        const srcNorm = (rm.source.module || '').toLowerCase().replace(/-/g, '');
        const curNorm = (moduleName || '').toLowerCase().replace(/-/g, '');
        if (srcNorm === curNorm) {
          checks['RM-010'].findings.push(
            finding(
              moduleName,
              `ReadModel "${name}": source.module "${rm.source.module}" es el mismo módulo actual`,
              `Los readModels son exclusivamente para proyecciones cross-module — moverlo al módulo consumidor`
            )
          );
        }
      }
    }
  }

  setDefaultSeverities(checks, {
    'RM-001': 'error',
    'RM-002': 'error',
    'RM-004': 'error',
    'RM-005': 'error',
    'RM-006': 'error',
    'RM-010': 'error',
  });

  return checks;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {Record<string, object>} domainConfigs  - moduleName → parsed domain YAML
 * @param {object}                 systemConfig   - parsed system.yaml
 * @returns {{ summary, categories, diagrams }}
 */
function validateDomain(domainConfigs, systemConfig) {
  const c1Checks = runC1(domainConfigs, systemConfig);
  const c2Checks = runC2(domainConfigs, systemConfig);
  const c3Checks = runC3(domainConfigs, systemConfig);
  const c4Checks = runC4(domainConfigs, systemConfig);
  const c5Checks = runC5(domainConfigs, systemConfig);
  const c6Checks = runC6(domainConfigs);

  const categories = [
    {
      id: 'C1',
      label: 'Contratos de Eventos Kafka',
      description: 'Verifica que el grafo productor→consumidor esté completo y los contratos de campos sean coherentes.',
      checks: checksToArray(c1Checks),
    },
    {
      id: 'C2',
      label: 'Gaps de Comportamiento',
      description: 'Verifica que cada transición de estado y cada use case tenga un mecanismo de activación trazable.',
      checks: checksToArray(c2Checks),
    },
    {
      id: 'C3',
      label: 'Integridad de Referencias Cruzadas',
      description: 'Verifica que todas las dependencias entre módulos estén declaradas y sean coherentes en ambos lados.',
      checks: checksToArray(c3Checks),
    },
    {
      id: 'C4',
      label: 'Auditoría y Trazabilidad',
      description: 'Verifica que las entidades críticas tengan mecanismos de trazabilidad de cambios.',
      checks: checksToArray(c4Checks),
    },
    {
      id: 'C5',
      label: 'Integridad de Workflows Temporal',
      description: 'Verifica que las actividades, compensaciones y contratos de tipos en workflows Temporal sean coherentes.',
      checks: checksToArray(c5Checks),
    },
    {
      id: 'C6',
      label: 'Integridad de ReadModels',
      description: 'Verifica que los readModels tengan estructura válida: nombre, tableName, campo id, syncedBy y source correctos.',
      checks: checksToArray(c6Checks),
    },
  ];

  // Compute summary
  let errors = 0, warnings = 0, info = 0, ok = 0;
  for (const cat of categories) {
    for (const check of cat.checks) {
      if (check.severity === 'error') errors++;
      else if (check.severity === 'warning') warnings++;
      else if (check.severity === 'info') info++;
      else ok++;
    }
  }

  const { generateDomainDiagrams } = require('./domain-diagram');
  const { generateBlueprintDiagrams } = require('./bounded-context-diagram');

  const blueprintResults = generateBlueprintDiagrams(domainConfigs, systemConfig);
  const blueprintDiagrams = {};
  const useCaseDetails = {};
  for (const [mod, result] of Object.entries(blueprintResults)) {
    blueprintDiagrams[mod] = result.diagram || '';
    useCaseDetails[mod] = result.useCases || {};
  }

  return {
    summary: { errors, warnings, info, ok },
    categories,
    diagrams: generateDomainDiagrams(domainConfigs),
    blueprints: blueprintDiagrams,
    useCaseDetails,
  };
}

function checksToArray(checksMap) {
  return Object.entries(checksMap).map(([id, check]) => ({
    id,
    label: check.label,
    severity: check.severity,
    findings: check.findings,
  }));
}

module.exports = { validateDomain };
