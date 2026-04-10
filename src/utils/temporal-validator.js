'use strict';

/**
 * Temporal Workflow Validator — T1/T2/T3 rules
 *
 * Called by evaluate-system.js when orchestration.engine === 'temporal'.
 * Operates on the enriched temporal context produced by extractTemporalReportData().
 *
 * @param {object} systemConfig  — Parsed system.yaml
 * @param {Record<string, object>} domainConfigs — moduleName → parsed domain YAML
 * @param {object} temporalCtx  — Pre-built temporal context from extractTemporalReportData()
 * @returns {{ summary, categories[], score }}
 */
function validateTemporal(systemConfig, domainConfigs, temporalCtx) {
  const { activityCatalog, workflows, moduleRoles } = temporalCtx;
  const rawWorkflows = systemConfig.workflows || [];
  const modules = systemConfig.modules || [];

  // ── Build quick lookup structures ─────────────────────────────────────────

  /** module camelCase → { activities: Map<PascalCaseName, actDef> } */
  const activityRegistry = buildActivityRegistry(domainConfigs);

  /** All domain events keyed by moduleName (camelCase) → Set<eventName> */
  const domainEventsByModule = buildDomainEventsByModule(domainConfigs);

  /** localWorkflows per module: moduleName → workflow[] */
  const localWorkflowsByModule = buildLocalWorkflowsByModule(domainConfigs);

  // ── Initialize checks ─────────────────────────────────────────────────────

  const checks = {
    // T1 — Activity Contracts
    'T1-001': { label: 'Actividad en step no declarada en domain.yaml del módulo target', severity: 'ok', findings: [] },
    'T1-002': { label: 'Campo output del step no existe en output[] formal de la actividad', severity: 'ok', findings: [] },
    'T1-003': { label: 'Campo input del step no resoluble (no en outputs anteriores ni en trigger)', severity: 'ok', findings: [] },
    'T1-004': { label: 'Compensation del step no declarada como actividad en el módulo', severity: 'ok', findings: [] },
    'T1-005': { label: 'ExternalType referencia módulo que no declara ese tipo en output de actividad', severity: 'ok', findings: [] },
    // T2 — Workflow Design
    'T2-001': { label: 'saga:true sin ningún step con compensation (saga vacía)', severity: 'ok', findings: [] },
    'T2-002': { label: 'Step async con compensation declarada (no se puede compensar async)', severity: 'ok', findings: [] },
    'T2-003': { label: 'Trigger on: apunta a evento no declarado en events[] del módulo', severity: 'ok', findings: [] },
    'T2-004': { label: 'Módulo trigger no tiene evento con notifies apuntando al workflow', severity: 'ok', findings: [] },
    // T3 — Activity Quality
    'T3-001': { label: 'Actividad declarada en domain.yaml pero no usada en ningún workflow (huérfana)', severity: 'ok', findings: [] },
    'T3-002': { label: 'Actividad heavy sin retryPolicy declarada', severity: 'ok', findings: [] },
    'T3-003': { label: 'Actividad compensation con output[] (las compensaciones no deben retornar datos)', severity: 'ok', findings: [] },
    'T3-004': { label: 'ExternalType cuya definición no existe en el módulo fuente declarado', severity: 'ok', findings: [] },
  };

  function finding(moduleName, message, context = '') {
    return { module: moduleName, message, context };
  }

  // ── T1 — Activity Contracts ───────────────────────────────────────────────

  for (const wf of rawWorkflows) {
    const wfName = wf.name || '(unnamed)';
    const triggerModule = wf.trigger && wf.trigger.module ? camelCase(wf.trigger.module) : null;
    const steps = Array.isArray(wf.steps) ? wf.steps : [];

    // Build data-flow context: which fields are available at each step
    const available = new Set(); // fields available from trigger or prior step outputs

    // Seed with trigger-level fields (we can't know exact fields, so we approximate
    // from the domain event that triggers this workflow)
    if (wf.trigger && wf.trigger.on && triggerModule) {
      const eventsForModule = domainEventsByModule.get(triggerModule) || new Map();
      for (const [, evDef] of eventsForModule) {
        if (normalizeMethodName(evDef.name) === normalizeMethodName(wf.trigger.on) ||
            normalizeMethodName(evDef.name).includes(normalizeMethodName(wf.trigger.on))) {
          for (const f of evDef.fields || []) {
            if (f && f.name) available.add(f.name);
          }
        }
      }
      // Also add the triggering identifier itself (e.g., cartId)
      const triggerOn = wf.trigger.on;
      if (triggerOn) available.add(triggerOn + 'Id');
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.activity) continue;

      const stepNum = i + 1;
      const actName = pascalCase(step.activity);
      const targetMod = step.target ? camelCase(step.target) : triggerModule;
      const moduleActivities = activityRegistry.get(targetMod) || new Map();
      const actDef = moduleActivities.get(actName);

      // T1-001: Activity not declared in target module
      if (!actDef) {
        checks['T1-001'].findings.push(
          finding(wfName, `Paso ${stepNum} (${actName}): actividad no declarada en activities[] del módulo '${targetMod}'`, `workflow: ${wfName}`)
        );
        // Add step outputs to available anyway for subsequent steps
        for (const o of step.output || []) available.add(typeof o === 'string' ? o : o.name);
        continue;
      }

      // T1-002: Step output field not in activity formal output
      const formalOutputNames = new Set((actDef.output || []).map((f) => (typeof f === 'string' ? f : f.name)));
      for (const o of step.output || []) {
        const oName = typeof o === 'string' ? o : o.name;
        if (oName && !formalOutputNames.has(oName)) {
          checks['T1-002'].findings.push(
            finding(wfName, `Paso ${stepNum} (${actName}): output '${oName}' no existe en output[] de la actividad — disponibles: [${[...formalOutputNames].join(', ')}]`, `workflow: ${wfName}`)
          );
        }
        available.add(oName);
      }
      // If no step.output was declared, add formal outputs anyway (they exist)
      if (!step.output || step.output.length === 0) {
        for (const o of actDef.output || []) {
          available.add(typeof o === 'string' ? o : o.name);
        }
      }

      // T1-003: Step input not resolvable
      const stepInputs = Array.isArray(step.input) ? step.input : [];
      for (const inField of stepInputs) {
        const inName = typeof inField === 'string' ? inField : inField.name;
        if (inName && !available.has(inName)) {
          checks['T1-003'].findings.push(
            finding(wfName, `Paso ${stepNum} (${actName}): input '${inName}' no está disponible desde outputs de pasos anteriores ni desde el trigger del workflow`, `workflow: ${wfName}, módulo target: ${targetMod}`)
          );
        }
      }

      // T1-004: Compensation not declared as activity in target module
      if (step.compensation) {
        const compName = pascalCase(step.compensation);
        const compDef = moduleActivities.get(compName);
        if (!compDef) {
          checks['T1-004'].findings.push(
            finding(wfName, `Paso ${stepNum} (${actName}): compensación '${compName}' no está declarada en activities[] del módulo '${targetMod}'`, `workflow: ${wfName}`)
          );
        }
      }
    }
  }

  // T1-005: ExternalType references module that doesn't declare that type in output
  const externalTypeDeps = temporalCtx.externalTypeDeps || [];
  for (const dep of externalTypeDeps) {
    // Check if sourceModule actually declares this type in any activity output
    const sourceActivities = activityRegistry.get(dep.sourceModule) || new Map();
    let typeFound = false;
    for (const [, actDef] of sourceActivities) {
      for (const nested of actDef.nestedTypes || []) {
        const nestedName = typeof nested === 'string' ? nested : nested.name;
        if (pascalCase(nestedName) === pascalCase(dep.typeName)) {
          typeFound = true;
          break;
        }
      }
      if (typeFound) break;
    }
    if (!typeFound) {
      checks['T1-005'].findings.push(
        finding(dep.consumerModule, `Activity '${dep.activityName}' usa externalType '${dep.typeName}' de módulo '${dep.sourceModule}', pero ese módulo no declara ese tipo en nestedTypes[] de ninguna actividad`, `módulo consumidor: ${dep.consumerModule}`)
      );
    }
  }

  // ── T2 — Workflow Design ──────────────────────────────────────────────────

  for (const wf of rawWorkflows) {
    const wfName = wf.name || '(unnamed)';
    const triggerModule = wf.trigger && wf.trigger.module ? camelCase(wf.trigger.module) : null;
    const steps = Array.isArray(wf.steps) ? wf.steps : [];

    // T2-001: saga:true with no step having compensation
    if (wf.saga === true) {
      const hasAnyCompensation = steps.some((s) => !!s.compensation);
      if (!hasAnyCompensation) {
        checks['T2-001'].findings.push(
          finding(wfName, `Workflow '${wfName}' declara saga:true pero ningún step tiene campo compensation — la saga no tiene rollback definido`, `workflow: ${wfName}`)
        );
      }
    }

    // T2-002: async step with compensation
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'async' && step.compensation) {
        checks['T2-002'].findings.push(
          finding(wfName, `Paso ${i + 1} (${step.activity}): tipo 'async' (fire-and-forget) no puede tener compensation — los pasos async no bloquean y no son compensables`, `workflow: ${wfName}`)
        );
      }
    }

    // T2-003: trigger.on not matching any event[] in trigger module
    if (wf.trigger && wf.trigger.on && triggerModule) {
      const eventsForModule = domainEventsByModule.get(triggerModule) || new Map();
      const triggerOn = wf.trigger.on;
      let found = false;
      for (const [evName] of eventsForModule) {
        if (normalizeMethodName(evName).includes(normalizeMethodName(triggerOn)) ||
            normalizeMethodName(triggerOn).includes(normalizeMethodName(evName))) {
          found = true;
          break;
        }
      }
      // Also check if it matches transition method names
      const domainCfg = domainConfigs[triggerModule] || {};
      for (const agg of domainCfg.aggregates || []) {
        for (const en of agg.enums || []) {
          for (const tr of en.transitions || []) {
            if (tr.method && normalizeMethodName(tr.method) === normalizeMethodName(triggerOn)) {
              found = true;
            }
          }
        }
      }
      if (!found) {
        checks['T2-003'].findings.push(
          finding(wfName, `Trigger on:'${triggerOn}' del workflow '${wfName}' no coincide con ningún evento[] ni transición declarada en el módulo '${triggerModule}'`, `workflow: ${wfName}, módulo: ${triggerModule}`)
        );
      }
    }

    // T2-004: trigger module has no event with notifies pointing to this workflow
    if (wf.trigger && wf.trigger.module && wf.name) {
      const trigMod = camelCase(wf.trigger.module);
      const domainCfg = domainConfigs[trigMod] || {};
      let notifiesFound = false;
      for (const agg of domainCfg.aggregates || []) {
        for (const ev of agg.events || []) {
          for (const notif of ev.notifies || []) {
            if (notif.workflow && normalizeMethodName(notif.workflow) === normalizeMethodName(wf.name)) {
              notifiesFound = true;
            }
          }
        }
      }
      if (!notifiesFound) {
        checks['T2-004'].findings.push(
          finding(wfName, `El módulo trigger '${trigMod}' no tiene ningún event[] con notifies apuntando al workflow '${wf.name}' — considera añadir notifies:[{workflow: '${wf.name}'}] al evento correspondiente`, `workflow: ${wfName}`)
        );
      }
    }
  }

  // ── T3 — Activity Quality ─────────────────────────────────────────────────

  // Build a set of all activities used in any workflow (cross-module + local)
  const usedActivities = new Set(); // "moduleName::ActivityName"
  for (const wf of rawWorkflows) {
    const triggerModule = wf.trigger && wf.trigger.module ? camelCase(wf.trigger.module) : null;
    for (const step of Array.isArray(wf.steps) ? wf.steps : []) {
      const actName = step.activity ? pascalCase(step.activity) : null;
      if (!actName) continue;
      const targetMod = step.target ? camelCase(step.target) : triggerModule;
      usedActivities.add(`${targetMod}::${actName}`);
      if (step.compensation) {
        usedActivities.add(`${targetMod}::${pascalCase(step.compensation)}`);
      }
    }
  }
  // Also count activities used in local workflows (declared in domain.yaml)
  for (const [modName, localWfs] of Object.entries(localWorkflowsByModule)) {
    for (const wf of localWfs) {
      for (const step of wf.steps || []) {
        if (step.activity) usedActivities.add(`${modName}::${pascalCase(step.activity)}`);
      }
    }
  }

  for (const [modName, modActivities] of activityRegistry) {
    for (const [actName, actDef] of modActivities) {
      const key = `${modName}::${actName}`;

      // T3-001: Activity not used in any workflow
      if (!usedActivities.has(key)) {
        checks['T3-001'].findings.push(
          finding(modName, `Actividad '${actName}' del módulo '${modName}' no es usada en ningún workflow (ni cross-module ni local) — podría ser una actividad huérfana o pendiente de conectar`, `módulo: ${modName}`)
        );
      }

      // T3-002: heavy activity without retryPolicy
      if ((actDef.type || '').toLowerCase() === 'heavy' && !actDef.retryPolicy) {
        checks['T3-002'].findings.push(
          finding(modName, `Actividad heavy '${actName}' del módulo '${modName}' no declara retryPolicy — las actividades heavy (larga duración) deberían tener una política de reintentos`, `módulo: ${modName}`)
        );
      }

      // T3-003: Compensation activity with output[] (compensations should not return data)
      const isCompensation = actDef.isCompensation;
      if (isCompensation && Array.isArray(actDef.output) && actDef.output.length > 0) {
        checks['T3-003'].findings.push(
          finding(modName, `Actividad de compensación '${actName}' del módulo '${modName}' declara output[] — las compensaciones no deben retornar datos ya que Temporal ignora su salida`, `módulo: ${modName}`)
        );
      }
    }
  }

  // T3-004: externalType module not found or type not declared in that module
  for (const dep of externalTypeDeps) {
    if (!domainConfigs[dep.sourceModule] && !domainConfigs[camelCase(dep.sourceModule)]) {
      checks['T3-004'].findings.push(
        finding(dep.consumerModule, `ExternalType '${dep.typeName}' referencia módulo '${dep.sourceModule}' que no existe en el sistema o no tiene domain.yaml`, `módulo consumidor: ${dep.consumerModule}, actividad: ${dep.activityName}`)
      );
    }
  }

  // ── Assign severities ─────────────────────────────────────────────────────

  const severityMap = {
    'T1-001': 'error',
    'T1-002': 'warning',
    'T1-003': 'error',
    'T1-004': 'error',
    'T1-005': 'warning',
    'T2-001': 'warning',
    'T2-002': 'error',
    'T2-003': 'warning',
    'T2-004': 'info',
    'T3-001': 'info',
    'T3-002': 'warning',
    'T3-003': 'warning',
    'T3-004': 'error',
  };

  let errCount = 0, warnCount = 0, infoCount = 0, okCount = 0;

  for (const [id, check] of Object.entries(checks)) {
    if (check.findings.length > 0) {
      check.severity = severityMap[id] || 'info';
      if (check.severity === 'error') errCount++;
      else if (check.severity === 'warning') warnCount++;
      else infoCount++;
    } else {
      check.severity = 'ok';
      okCount++;
    }
  }

  const categories = [
    {
      id: 'T1',
      label: 'Contratos de Actividades',
      checks: ['T1-001', 'T1-002', 'T1-003', 'T1-004', 'T1-005'].map((id) => ({ id, ...checks[id] })),
    },
    {
      id: 'T2',
      label: 'Diseño de Workflows',
      checks: ['T2-001', 'T2-002', 'T2-003', 'T2-004'].map((id) => ({ id, ...checks[id] })),
    },
    {
      id: 'T3',
      label: 'Calidad de Actividades',
      checks: ['T3-001', 'T3-002', 'T3-003', 'T3-004'].map((id) => ({ id, ...checks[id] })),
    },
  ];

  const total = okCount + errCount + warnCount * 0.5;
  const score = total > 0 ? Math.round((okCount / total) * 100) : 100;

  return {
    summary: { errors: errCount, warnings: warnCount, info: infoCount, ok: okCount },
    categories,
    score,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a registry: moduleCamelCase → Map<ActivityPascalCase, activityDefinition>
 * Also marks compensation activities (isCompensation=true) based on cross-references.
 */
function buildActivityRegistry(domainConfigs) {
  const registry = new Map();

  // First pass: collect all activities
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (!domainCfg || !Array.isArray(domainCfg.activities)) continue;
    const modKey = camelCase(modName);
    const modMap = new Map();
    for (const act of domainCfg.activities) {
      const actKey = pascalCase(act.name);
      modMap.set(actKey, { ...act, isCompensation: false });
    }
    registry.set(modKey, modMap);
  }

  // Second pass: mark compensation activities
  for (const [, modMap] of registry) {
    for (const [, actDef] of modMap) {
      if (actDef.compensation) {
        const compName = pascalCase(actDef.compensation);
        if (modMap.has(compName)) {
          modMap.get(compName).isCompensation = true;
        }
      }
    }
  }

  return registry;
}

/**
 * Builds: moduleCamelCase → Map<normalizedEventName, { name, fields[], notifies[] }>
 */
function buildDomainEventsByModule(domainConfigs) {
  const result = new Map();
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    const modKey = camelCase(modName);
    const evMap = new Map();
    for (const agg of domainCfg?.aggregates || []) {
      for (const ev of agg.events || []) {
        evMap.set(normalizeMethodName(ev.name), {
          name: ev.name,
          fields: ev.fields || [],
          notifies: ev.notifies || [],
        });
      }
    }
    result.set(modKey, evMap);
  }
  return result;
}

/**
 * Builds: moduleCamelCase → workflow[]  (local workflows in domain.yaml)
 */
function buildLocalWorkflowsByModule(domainConfigs) {
  const result = {};
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (domainCfg && Array.isArray(domainCfg.workflows) && domainCfg.workflows.length > 0) {
      result[camelCase(modName)] = domainCfg.workflows;
    }
  }
  return result;
}

function camelCase(str) {
  if (!str) return '';
  return str
    .replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (c) => c.toLowerCase());
}

function pascalCase(str) {
  if (!str) return '';
  const c = camelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function normalizeMethodName(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[-_\s]/g, '').replace(/event$/, '');
}

module.exports = { validateTemporal };
