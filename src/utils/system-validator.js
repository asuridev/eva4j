'use strict';

const { toPascalCase, toCamelCase } = require('./naming');

/**
 * Validates a parsed system.yaml object against the S1–S5 static evaluation rules.
 *
 * @param {object} systemConfig - Parsed system.yaml content
 * @param {Record<string, object>} [domainConfigs={}] - moduleName → parsed domain YAML (used to check domain-level events)
 * @returns {{ errors: string[], warnings: string[], info: string[], ok: string[], score: number }}
 */
function validateSystem(systemConfig, domainConfigs = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const ok = [];

  const modules = systemConfig.modules || [];
  const moduleNames = new Set(modules.map((m) => m.name));
  const integrations = systemConfig.integrations || {};
  const asyncEvents = integrations.async || [];
  const syncIntegrations = integrations.sync || [];
  const messaging = systemConfig.messaging || {};
  const topicPrefix = (messaging.kafka || {}).topicPrefix || null;

  // Helper: normalize a consumer entry to its module name string
  const consumerModule = (c) => (typeof c === 'string' ? c : c.module);

  // ── S1 — Integridad de módulos ────────────────────────────────────────────

  // Collect all module names referenced in integrations
  const referencedInIntegrations = new Set();
  for (const ev of asyncEvents) {
    if (ev.producer) referencedInIntegrations.add(ev.producer);
    for (const c of ev.consumers || []) referencedInIntegrations.add(consumerModule(c));
  }
  for (const sync of syncIntegrations) {
    if (sync.caller) referencedInIntegrations.add(sync.caller);
    if (sync.calls) referencedInIntegrations.add(sync.calls);
  }

  // S1-001: module referenced but not declared
  let s1_001_found = false;
  for (const ref of referencedInIntegrations) {
    if (!moduleNames.has(ref)) {
      errors.push(`[S1-001] Módulo '${ref}' referenciado en integrations pero no declarado en modules[]`);
      s1_001_found = true;
    }
  }
  if (!s1_001_found) {
    ok.push('[S1-001] Todos los módulos referenciados en integrations están declarados en modules[] ✓');
  }

  // S1-002: module with no responsibilities
  let s1_002_found = false;
  for (const mod of modules) {
    const hasExposes = (mod.exposes || []).length > 0;
    const producesEvents = asyncEvents.some((e) => e.producer === mod.name);
    const consumesEvents = asyncEvents.some((e) =>
      (e.consumers || []).some((c) => consumerModule(c) === mod.name)
    );
    if (!hasExposes && !producesEvents && !consumesEvents) {
      errors.push(`[S1-002] Módulo '${mod.name}' no tiene ninguna responsabilidad — no expone endpoints, no produce ni consume eventos`);
      s1_002_found = true;
    }
  }
  if (!s1_002_found) {
    ok.push('[S1-002] Todos los módulos tienen al menos una responsabilidad declarada ✓');
  }

  // S1-003: module without description
  let s1_003_found = false;
  for (const mod of modules) {
    if (!mod.description || mod.description.trim() === '') {
      warnings.push(`[S1-003] Módulo '${mod.name}' no tiene campo description declarado`);
      s1_003_found = true;
    }
  }
  if (!s1_003_found) {
    ok.push('[S1-003] Todos los módulos tienen description declarado ✓');
  }

  // S1-004: purely reactive module not documented
  for (const mod of modules) {
    const producesEvents = asyncEvents.some((e) => e.producer === mod.name);
    const consumesEvents = asyncEvents.some((e) =>
      (e.consumers || []).some((c) => consumerModule(c) === mod.name)
    );
    const makesSyncCalls = syncIntegrations.some((s) => s.caller === mod.name);
    const hasExposes = (mod.exposes || []).length > 0;

    const isPurelyReactive = consumesEvents && !producesEvents && !makesSyncCalls && !hasExposes;
    if (isPurelyReactive) {
      const desc = (mod.description || '').toLowerCase();
      const documentedAsReactive = desc.includes('consume') || desc.includes('reactiv') || desc.includes('event') || desc.includes('suscri') || desc.includes('listen');
      if (!documentedAsReactive) {
        info.push(`[S1-004] Módulo '${mod.name}' es puramente reactivo (solo consume eventos) pero su description no lo documenta explícitamente`);
      }
    }
  }

  // ── S2 — Integridad del grafo de eventos async ────────────────────────────

  // S2-001: event with no consumers
  let s2_001_found = false;
  for (const ev of asyncEvents) {
    const consumers = ev.consumers || [];
    if (consumers.length === 0) {
      errors.push(`[S2-001] Evento '${ev.event}' declarado en integrations.async sin consumidores`);
      s2_001_found = true;
    }
  }
  if (!s2_001_found && asyncEvents.length > 0) {
    ok.push('[S2-001] Todos los eventos async tienen al menos un consumidor declarado ✓');
  }

  // S2-002: duplicate topic values
  const topicToEvent = {};
  let s2_002_found = false;
  for (const ev of asyncEvents) {
    if (!ev.topic) continue;
    if (topicToEvent[ev.topic]) {
      errors.push(`[S2-002] Topic '${ev.topic}' está declarado para dos eventos distintos: '${topicToEvent[ev.topic]}' y '${ev.event}'`);
      s2_002_found = true;
    } else {
      topicToEvent[ev.topic] = ev.event;
    }
  }
  if (!s2_002_found && asyncEvents.length > 0) {
    ok.push('[S2-002] No hay colisiones de topics en integrations.async ✓');
  }

  // S2-003: self-loop (module consuming its own event)
  let s2_003_found = false;
  for (const ev of asyncEvents) {
    for (const c of ev.consumers || []) {
      if (consumerModule(c) === ev.producer) {
        errors.push(`[S2-003] Módulo '${ev.producer}' está listado como consumidor de su propio evento '${ev.event}' (self-loop)`);
        s2_003_found = true;
      }
    }
  }
  if (!s2_003_found && asyncEvents.length > 0) {
    ok.push('[S2-003] No se detectaron self-loops en el grafo de eventos ✓');
  }

  // S2-004: module produces but never consumes
  const producerSet = new Set(asyncEvents.map((e) => e.producer).filter(Boolean));
  const consumerSet = new Set(
    asyncEvents.flatMap((e) => (e.consumers || []).map(consumerModule))
  );
  for (const mod of modules) {
    if (producerSet.has(mod.name) && !consumerSet.has(mod.name)) {
      warnings.push(`[S2-004] Módulo '${mod.name}' produce eventos pero no consume ninguno`);
    }
  }

  // S2-005: module consumes but never produces
  // Also check domain-level events[] — a module may produce Domain Events not yet
  // wired in system.yaml integrations.async[], which is a valid design-in-progress.
  for (const mod of modules) {
    if (consumerSet.has(mod.name) && !producerSet.has(mod.name)) {
      const domainCfg = domainConfigs[mod.name];
      const producesDomainEvents = (domainCfg?.aggregates || []).some(
        (agg) => (agg.events || []).length > 0
      );
      if (!producesDomainEvents) {
        warnings.push(`[S2-005] Módulo '${mod.name}' consume eventos pero no produce ninguno`);
      }
    }
  }

  // S2-006: event name not following PascalCase + Event suffix
  const eventNameRegex = /^[A-Z][a-zA-Z0-9]*Event$/;
  let s2_006_found = false;
  for (const ev of asyncEvents) {
    if (ev.event && !eventNameRegex.test(ev.event)) {
      warnings.push(`[S2-006] Nombre de evento '${ev.event}' no sigue la convención PascalCase con sufijo 'Event'`);
      s2_006_found = true;
    }
  }
  if (!s2_006_found && asyncEvents.length > 0) {
    ok.push('[S2-006] Todos los nombres de eventos siguen la convención PascalCase + sufijo Event ✓');
  }

  // ── S3 — Integridad de llamadas síncronas ────────────────────────────────

  // S3-001: sync call to module with no exposes
  let s3_001_found = false;
  for (const sync of syncIntegrations) {
    if (!moduleNames.has(sync.calls)) continue; // already caught by S1-001
    const targetMod = modules.find((m) => m.name === sync.calls);
    if (targetMod && (!targetMod.exposes || targetMod.exposes.length === 0)) {
      errors.push(`[S3-001] '${sync.caller}' llama síncronamente a '${sync.calls}' pero este módulo no declara exposes[]`);
      s3_001_found = true;
    }
  }
  if (!s3_001_found && syncIntegrations.length > 0) {
    ok.push('[S3-001] Todos los módulos destino de llamadas síncronas tienen endpoints expuestos ✓');
  }

  // S3-002: endpoint in using[] not found in target exposes[]
  let s3_002_found = false;
  for (const sync of syncIntegrations) {
    if (!moduleNames.has(sync.calls)) continue;
    const targetMod = modules.find((m) => m.name === sync.calls);
    const targetExposes = (targetMod?.exposes || []).map((ep) => `${ep.method} ${ep.path}`);
    for (const endpoint of sync.using || []) {
      const found = targetExposes.some((ep) => endpointMatches(ep, endpoint));
      if (!found) {
        errors.push(`[S3-002] Endpoint '${endpoint}' usado por '${sync.caller}' no está declarado en exposes[] de '${sync.calls}'`);
        s3_002_found = true;
      }
    }
  }
  if (!s3_002_found && syncIntegrations.length > 0) {
    ok.push('[S3-002] Todos los endpoints referenciados en llamadas síncronas existen en el módulo destino ✓');
  }

  // S3-003: bidirectional sync coupling (WARNING, not error)
  const biDirChecked = new Set();
  let s3_003_found = false;
  for (const sync of syncIntegrations) {
    const key = [sync.caller, sync.calls].sort().join('↔');
    if (biDirChecked.has(key)) continue;
    biDirChecked.add(key);
    const reverse = syncIntegrations.find(
      (s) => s.caller === sync.calls && s.calls === sync.caller
    );
    if (reverse) {
      warnings.push(`[S3-003] Acoplamiento síncrono bidireccional: '${sync.caller}' llama a '${sync.calls}' y viceversa`);
      s3_003_found = true;
    }
  }
  if (!s3_003_found && syncIntegrations.length > 0) {
    ok.push('[S3-003] No se detectó acoplamiento síncrono bidireccional ✓');
  }

  // S3-004: module with more than 3 distinct outgoing sync dependencies
  const outgoingSyncDeps = {};
  for (const sync of syncIntegrations) {
    if (!outgoingSyncDeps[sync.caller]) outgoingSyncDeps[sync.caller] = new Set();
    outgoingSyncDeps[sync.caller].add(sync.calls);
  }
  for (const [caller, deps] of Object.entries(outgoingSyncDeps)) {
    if (deps.size > 3) {
      warnings.push(`[S3-004] Módulo '${caller}' tiene ${deps.size} dependencias síncronas salientes distintas (>${3}): ${[...deps].join(', ')}`);
    }
  }

  // S3-005: module consulted synchronously but emits no events
  const syncCallees = new Set(syncIntegrations.map((s) => s.calls).filter(Boolean));
  for (const callee of syncCallees) {
    const producesAny = asyncEvents.some((e) => e.producer === callee);
    if (!producesAny) {
      info.push(`[S3-005] Módulo '${callee}' es consultado síncronamente pero no emite ningún evento cuando su estado cambia`);
    }
  }

  // S3-006: duplicate port name across different caller modules → ConflictingBeanDefinitionException
  let s3_006_found = false;
  const portsByName = {};
  for (const sync of syncIntegrations) {
    const portName = sync.port;
    if (!portName) continue;
    if (!portsByName[portName]) portsByName[portName] = [];
    portsByName[portName].push(sync.caller);
  }
  for (const [portName, callers] of Object.entries(portsByName)) {
    const uniqueCallers = [...new Set(callers)];
    if (uniqueCallers.length > 1) {
      const suggestions = uniqueCallers.map((c) => {
        const prefix = c.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
        return `${prefix[0].toUpperCase() + prefix.slice(1)}${portName}`;
      }).join(', ');
      errors.push(
        `[S3-006] Port '${portName}' es usado por módulos distintos (${uniqueCallers.join(', ')}). ` +
        `Esto causa ConflictingBeanDefinitionException en Spring. ` +
        `Cada módulo debe usar un nombre propio: ej. ${suggestions}`
      );
      s3_006_found = true;
    }
  }
  if (!s3_006_found && syncIntegrations.length > 0) {
    ok.push('[S3-006] No hay nombres de port duplicados entre módulos distintos ✓');
  }

  // ── S4 — Coherencia de endpoints ─────────────────────────────────────────

  for (const mod of modules) {
    const exposes = mod.exposes || [];

    // S4-001: duplicate METHOD + path within same module
    const endpointKeys = new Set();
    for (const ep of exposes) {
      const key = `${(ep.method || '').toUpperCase()} ${ep.path || ''}`;
      if (endpointKeys.has(key)) {
        errors.push(`[S4-001] Módulo '${mod.name}' tiene dos endpoints con el mismo método y path: ${key}`);
      } else {
        endpointKeys.add(key);
      }
    }

    // S4-002: PUT /{id} without GET /{id} for same resource base
    for (const ep of exposes) {
      if ((ep.method || '').toUpperCase() !== 'PUT') continue;
      // Normalize path param to detect /{id} pattern
      const normalizedPut = (ep.path || '').replace(/\{[^}]+\}$/, '{id}');
      if (!normalizedPut.match(/\{id\}$/)) continue; // only check PUT /{id} style paths
      const resourceBase = normalizedPut.replace(/\{id\}$/, '{id}');
      const hasGet = exposes.some(
        (g) => (g.method || '').toUpperCase() === 'GET' &&
          (g.path || '').replace(/\{[^}]+\}$/, '{id}') === resourceBase
      );
      if (!hasGet) {
        warnings.push(`[S4-002] Módulo '${mod.name}' tiene PUT ${ep.path} sin el correspondiente GET ${ep.path}`);
      }
    }

    // S4-003: DELETE without description documenting physical vs logical
    for (const ep of exposes) {
      if ((ep.method || '').toUpperCase() !== 'DELETE') continue;
      if (!ep.description || ep.description.trim() === '') {
        warnings.push(`[S4-003] Endpoint DELETE ${ep.path} en '${mod.name}' no tiene description que indique si el borrado es físico o lógico`);
      }
    }

    // S4-004: endpoint without description (info)
    for (const ep of exposes) {
      if (!ep.description || ep.description.trim() === '') {
        info.push(`[S4-004] Endpoint ${ep.method} ${ep.path} en '${mod.name}' no tiene campo description`);
      }
    }

    // S4-005: module with POST but no GET /{id} (info)
    const hasPost = exposes.some((ep) => (ep.method || '').toUpperCase() === 'POST');
    if (hasPost) {
      const hasGetById = exposes.some(
        (ep) => (ep.method || '').toUpperCase() === 'GET' &&
          /\{[^}]+\}$/.test(ep.path || '')
      );
      if (!hasGetById) {
        info.push(`[S4-005] Módulo '${mod.name}' tiene POST de creación pero no declara GET /{id} para recuperar el recurso creado`);
      }
    }
  }

  // ── S5 — Coherencia del sistema global ───────────────────────────────────

  // S5-001: messaging.enabled: false with async events declared
  if (messaging.enabled === false && asyncEvents.length > 0) {
    warnings.push(`[S5-001] messaging.enabled está en false pero hay ${asyncEvents.length} eventos declarados en integrations.async`);
  } else if (messaging.enabled !== false && asyncEvents.length > 0) {
    ok.push('[S5-001] Configuración de messaging es coherente con los eventos declarados ✓');
  }

  // S5-002: success event without matching failure event for same subject
  // Suffixes that represent external operations with side-effects → warning if no failure counterpart
  const successSuffixesWarning = ['confirmedevent', 'approvedevent', 'placedevent', 'activatedevent'];
  // Suffixes that represent physical/irreversible facts → info only (compensation less expected)
  const successSuffixesInfo = ['completedevent'];
  const failureSuffixes = ['failedevent', 'rejectedevent', 'cancelledevent', 'canceledevent', 'expiredevent'];

  for (const ev of asyncEvents) {
    const evLower = (ev.event || '').toLowerCase();
    const matchedWarning = successSuffixesWarning.find((s) => evLower.endsWith(s));
    const matchedInfo = !matchedWarning && successSuffixesInfo.find((s) => evLower.endsWith(s));
    const matched = matchedWarning || matchedInfo;
    if (!matched) continue;

    // Derive subject: strip the matched suffix
    const subjectLength = evLower.length - matched.length;
    const subject = evLower.slice(0, subjectLength);

    // Check if there's any failure event with the same subject prefix
    const hasFailure = asyncEvents.some((other) => {
      const otherLower = (other.event || '').toLowerCase();
      return failureSuffixes.some((f) => otherLower.endsWith(f) && otherLower.startsWith(subject));
    });

    if (!hasFailure) {
      const msg = `[S5-002] Evento de éxito '${ev.event}' existe pero no hay un evento de fallo correspondiente para el sujeto '${subject}' que permita compensación`;
      if (matchedWarning) {
        warnings.push(msg);
      } else {
        info.push(msg);
      }
    }
  }

  // S5-003: auth/security module with no integrations (info)
  const authPattern = /auth|security|identity|session/i;
  for (const mod of modules) {
    if (!authPattern.test(mod.name)) continue;
    const hasAnyIntegration =
      asyncEvents.some((e) => e.producer === mod.name || (e.consumers || []).some((c) => consumerModule(c) === mod.name)) ||
      syncIntegrations.some((s) => s.caller === mod.name || s.calls === mod.name);
    if (!hasAnyIntegration) {
      info.push(`[S5-003] Módulo '${mod.name}' parece manejar autenticación/seguridad pero no tiene ninguna integración declarada con otros módulos`);
    }
  }

  // S5-004: module with no connection to system graph (info)
  for (const mod of modules) {
    const hasAnyConnection =
      asyncEvents.some((e) => e.producer === mod.name || (e.consumers || []).some((c) => consumerModule(c) === mod.name)) ||
      syncIntegrations.some((s) => s.caller === mod.name || s.calls === mod.name);
    if (!hasAnyConnection) {
      info.push(`[S5-004] Módulo '${mod.name}' no tiene ninguna conexión al grafo del sistema — ni async ni sync`);
    }
  }

  // ── T1 — Temporal Workflow Integrity ──────────────────────────────────────
  const orchestration = systemConfig.orchestration || {};
  if (orchestration.enabled && Array.isArray(systemConfig.workflows)) {
    // Build activity registry from domainConfigs: PascalCase name → { module, input[], output[] }
    const activityMap = new Map();
    for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
      if (!domainCfg || !Array.isArray(domainCfg.activities)) continue;
      const modCamel = toCamelCase(modName);
      for (const act of domainCfg.activities) {
        const actPascal = toPascalCase(act.name);
        const inputNames = Array.isArray(act.input) ? act.input.map((f) => f.name || f) : [];
        const outputNames = Array.isArray(act.output) ? act.output.map((f) => f.name || f) : [];
        activityMap.set(`${modCamel}::${actPascal}`, { module: modCamel, inputNames, outputNames });
      }
    }

    let t1_001_found = false;
    let t1_002_found = false;
    let t1_004_found = false;
    let t1_006_found = false;

    for (const wf of systemConfig.workflows) {
      const wfName = wf.name || '(unnamed)';
      const hostModule = wf.trigger && wf.trigger.module ? toCamelCase(wf.trigger.module) : null;
      const rawSteps = Array.isArray(wf.steps) ? wf.steps : [];

      // Track available output names from prior steps for T1-002
      const availableOutputNames = new Set();

      // Compute workflow-level input names: step inputs not satisfied by prior step outputs
      // (first pass to collect all step outputs)
      const allStepOutputs = new Map(); // stepIndex → rawOutputNames
      for (let i = 0; i < rawSteps.length; i++) {
        const rawOut = Array.isArray(rawSteps[i].output) ? rawSteps[i].output : [];
        allStepOutputs.set(i, new Set(rawOut));
      }

      // Compute workflow-level inputs: inputs not provided by any prior step's output
      const workflowInputNames = new Set();
      const priorOutputs = new Set();
      for (let i = 0; i < rawSteps.length; i++) {
        const stepInputs = Array.isArray(rawSteps[i].input) ? rawSteps[i].input : [];
        for (const inName of stepInputs) {
          if (!priorOutputs.has(inName)) {
            workflowInputNames.add(inName);
          }
        }
        const stepOutputs = allStepOutputs.get(i) || new Set();
        for (const outName of stepOutputs) {
          priorOutputs.add(outName);
        }
      }

      for (let i = 0; i < rawSteps.length; i++) {
        const step = rawSteps[i];
        const actName = step.activity ? toPascalCase(step.activity) : null;
        if (!actName) continue;

        const targetModule = step.target ? toCamelCase(step.target) : hostModule;
        const key = `${targetModule}::${actName}`;
        const registered = activityMap.get(key);

        // T1-004: Activity not found in target module
        if (!registered) {
          warnings.push(`[T1-004] Workflow '${wfName}' paso ${i + 1}: actividad '${actName}' no encontrada en activities[] de '${targetModule}'`);
          t1_004_found = true;
        }

        // T1-001: Step output name not in activity's formal output fields
        const rawOutputNames = Array.isArray(step.output) ? step.output : [];
        if (registered && rawOutputNames.length > 0) {
          const formalOutputSet = new Set(registered.outputNames);
          for (const outName of rawOutputNames) {
            if (!formalOutputSet.has(outName)) {
              errors.push(`[T1-001] Workflow '${wfName}' paso ${i + 1} (${actName}): output '${outName}' no existe en los campos de salida de la actividad — campos disponibles: [${registered.outputNames.join(', ')}]`);
              t1_001_found = true;
            }
          }

          // T1-003: Step output count exceeds activity formal output count
          if (rawOutputNames.length > registered.outputNames.length) {
            warnings.push(`[T1-003] Workflow '${wfName}' paso ${i + 1} (${actName}): declara ${rawOutputNames.length} outputs pero la actividad solo define ${registered.outputNames.length} campos de salida`);
          }
        }

        // T1-002: Step input name not resolvable
        const rawInputNames = Array.isArray(step.input) ? step.input : [];
        if (rawInputNames.length > 0) {
          for (const inName of rawInputNames) {
            if (!availableOutputNames.has(inName)) {
              // Not from a prior step — must come from workflow input (OK, no error)
              // But if we detect it's truly orphaned, we'd need full data-flow analysis.
              // For now, we skip pure workflow-input names (they're always valid).
            }
          }
        }

        // T1-005: Sync step with no output declaration
        if (step.type !== 'async' && rawOutputNames.length === 0 && registered && registered.outputNames.length > 0) {
          info.push(`[T1-005] Workflow '${wfName}' paso ${i + 1} (${actName}): paso síncrono sin output: declarado — la actividad define ${registered.outputNames.length} campo(s) de salida que no se propagan`);
        }

        // Add this step's outputs to available set for subsequent steps
        for (const outName of rawOutputNames) {
          availableOutputNames.add(outName);
        }

        // T1-006: Compensation input field not resolvable
        if (step.compensation) {
          const compName = toPascalCase(step.compensation);
          const compTarget = step.target ? toCamelCase(step.target) : hostModule;
          const compKey = `${compTarget}::${compName}`;
          const compRegistered = activityMap.get(compKey);
          if (compRegistered) {
            for (const compIn of compRegistered.inputNames) {
              if (!availableOutputNames.has(compIn) && !workflowInputNames.has(compIn)) {
                errors.push(`[T1-006] Workflow '${wfName}' paso ${i + 1} (${actName}): compensación '${compName}' requiere input '${compIn}' pero no está disponible en outputs de pasos previos ni en inputs del workflow`);
                t1_006_found = true;
              }
            }
          }
        }
      }
    }

    if (!t1_001_found) {
      ok.push('[T1-001] Todos los outputs de pasos de workflow coinciden con campos formales de la actividad ✓');
    }
    if (!t1_004_found) {
      ok.push('[T1-004] Todas las actividades referenciadas en workflows existen en sus módulos target ✓');
    }
    if (!t1_006_found) {
      ok.push('[T1-006] Todos los inputs de compensaciones son resolubles desde outputs de pasos previos o inputs del workflow ✓');
    }
  }

  // ── Score (info items do not affect score) ────────────────────────────────

  const total = ok.length + errors.length + warnings.length * 0.5;
  const score = total > 0 ? Math.round((ok.length / total) * 100) : 100;

  return { errors, warnings, info, ok, score };
}

/**
 * Compares two HTTP endpoint strings with path param normalization.
 * e.g.  "GET /screenings/{id}/seats"  matches  "GET /screenings/{id}/seats"
 * Path params ({anything}) are treated as wildcards.
 */
function endpointMatches(declared, used) {
  const normalizePath = (str) =>
    str
      .trim()
      .toUpperCase()
      .replace(/\{[^}]+\}/g, '{*}')
      .replace(/\/+$/, '');
  return normalizePath(declared) === normalizePath(used);
}

module.exports = { validateSystem };
