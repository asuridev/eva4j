'use strict';

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
 *   C4 — Behavior Gaps
 *   C5 — Cross-Reference Integrity
 *   C6 — Audit & Traceability
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
    }
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
      consumers: (ev.consumers || []).map((c) => (typeof c === 'string' ? c : c.module)),
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
    'C1-005': { label: 'system.yaml registra consumidor pero módulo no tiene listener declarado', severity: 'ok', findings: [] },
    'C1-006': { label: 'Listener declara producer: incorrecto', severity: 'ok', findings: [] },
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

  // C1-005: system.yaml consumer present but module has no listener
  for (const [eventName, sysEntry] of Object.entries(systemAsyncMap)) {
    for (const consumerModule of sysEntry.consumers) {
      const consumerConfig = domainConfigs[consumerModule];
      if (!consumerConfig) continue; // module domain.yaml not loaded — skip
      const hasListener = (consumerConfig.listeners || []).some((l) => l.event === eventName);
      if (!hasListener) {
        checks['C1-005'].findings.push(
          finding(
            consumerModule,
            `system.yaml registra '${consumerModule}' como consumidor de '${eventName}' pero el módulo no tiene listener declarado`,
            `Evento producido por: ${sysEntry.producer}`
          )
        );
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

  // Assign severities
  setDefaultSeverities(checks, {
    'C1-001': 'warning',
    'C1-002': 'error',
    'C1-003': 'error',
    'C1-004': 'error',
    'C1-005': 'error',
    'C1-006': 'error',
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
                `Agregado: ${agg.name}, Enum: ${en.name}`
              )
            );
          }
        }
      }
    }

    // C2-004: event trigger references a method that does not exist in any transition
    const allTransitionMethods = new Set();
    for (const agg of config.aggregates || []) {
      for (const en of agg.enums || []) {
        for (const tr of en.transitions || []) {
          if (tr.method) allTransitionMethods.add(tr.method);
        }
      }
    }
    for (const agg of config.aggregates || []) {
      for (const ev of agg.events || []) {
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
    // Also include listener event names and field names as traceable origins.
    // Field names cover cases like wasLateReturn → [late, return] tracing LATE_RETURN,
    // where the semantic connection is in a boolean field name, not the event name itself.
    for (const listener of config.listeners || []) {
      for (const w of extractWords(listener.event)) moduleEventTokens.add(w);
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
          const traceable = valWords.some((w) => moduleEventTokens.has(w));
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

    // C2-006: useCase name collision between endpoints and listeners
    // Both generate "{UseCase}Command.java" — the endpoint run overwrites the listener version.
    const domainEpUseCases = new Set();
    for (const ver of (config.endpoints && config.endpoints.versions) || []) {
      for (const op of ver.operations || []) {
        if (op.useCase) domainEpUseCases.add(op.useCase);
      }
    }
    for (const listener of config.listeners || []) {
      const uc = listener.useCase;
      if (uc && domainEpUseCases.has(uc)) {
        checks['C2-006'].findings.push(
          finding(
            moduleName,
            `UseCase '${uc}' está declarado en endpoints: y en listeners: (evento '${listener.event}')`,
            `Ambos generan '${uc}Command.java' — el endpoint sobreescribe el comando del listener. Renombra el useCase del listener, p.ej. '${uc.replace(/^Create/, 'Initialize')}'.`
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

  setDefaultSeverities(checks, {
    'C3-001': 'info',    // reference.module may come from request context (JWT/header) — not always an active integration
    'C3-002': 'error',
    'C3-003': 'warning',
    'C3-004': 'warning',
    'C3-005': 'error',
    'C3-006': 'warning',
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
          if (critical && field.readOnly && !field.hidden && !isSystemConstant && !isStateMachineField && !AUDIT_FIELDS.has(field.name)) {
            if (!moduleEventFieldNames.has(field.name)) {
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

  return {
    summary: { errors, warnings, info, ok },
    categories,
    diagrams: generateDomainDiagrams(domainConfigs),
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
