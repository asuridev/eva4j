'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const http = require('http');
const ejs = require('ejs');
const ora = require('ora');

const { validateSystem } = require('../utils/system-validator');
const { validateDomain } = require('../utils/domain-validator');
const { validateTemporal } = require('../utils/temporal-validator');

// ── Module icon heuristic ────────────────────────────────────────────────────

const ICON_RULES = [
  [/payment|billing|invoice|charge/i, '💳'],
  [/notification|alert|email|sms|message|notify/i, '🔔'],
  [/customer|user|account|profile|member|client/i, '👤'],
  [/movie|film|cinema|content|catalog|media/i, '🎬'],
  [/theater|venue|seat|hall|screen/i, '🏛️'],
  [/reservation|booking|ticket|order/i, '🎟️'],
  [/product|item|inventory|catalog|stock/i, '🛍️'],
  [/shipping|delivery|logistics|warehouse/i, '📦'],
  [/auth|security|identity|session/i, '🔐'],
  [/report|analytics|metric|stat/i, '📊'],
  [/search|index|discover/i, '🔍'],
  [/screening|schedule|program|event/i, '📽️'],
];

const COLOR_PALETTE = [
  '#4a9eff', // blue
  '#9b6dff', // purple
  '#f5c842', // gold
  '#2dcc8f', // green
  '#ff8c42', // orange
  '#e63950', // red/accent
  '#40c4d0', // teal
  '#ff6bac', // pink
  '#a8e063', // lime
  '#ffa07a', // salmon
];

function assignIcon(name) {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(name)) return icon;
  }
  return '📁';
}

// ── Flow auto-generation from async events ───────────────────────────────────

// Maps trailing verb in an event name to the action verb used in useCases
const EVENT_VERB_MAP = {
  created: 'Create',
  confirmed: 'Confirm',
  approved: 'Approve',
  rejected: 'Reject',
  cancelled: 'Cancel',
  canceled: 'Cancel',
  locked: 'Lock',
  unlocked: 'Unlock',
  expired: 'Expire',
  scheduled: 'Schedule',
  processed: 'Process',
  published: 'Publish',
  updated: 'Update',
  deleted: 'Delete',
  completed: 'Complete',
  failed: 'Fail',
  started: 'Start',
  initiated: 'Initiate',
  activated: 'Activate',
  deactivated: 'Deactivate',
  registered: 'Register',
  requested: 'Request',
};

function extractEventVerb(eventName) {
  // e.g. "ReservationCreatedEvent" → "created" → "Create"
  const withoutSuffix = eventName.replace(/Event$/, '');
  const parts = withoutSuffix.split(/(?=[A-Z])/); // split on uppercase
  const lastWord = parts[parts.length - 1].toLowerCase();
  return EVENT_VERB_MAP[lastWord] || null;
}

function extractEventSubject(eventName) {
  // e.g. "ReservationCreatedEvent" → "Reservation"
  const withoutSuffix = eventName.replace(/Event$/, '');
  const verb = extractEventVerb(eventName);
  if (!verb) return withoutSuffix;
  const verbKey = Object.keys(EVENT_VERB_MAP).find(
    (k) => EVENT_VERB_MAP[k] === verb
  );
  if (!verbKey) return withoutSuffix;
  // Remove the trailing verb word from the event name
  const verbCamel = verbKey.charAt(0).toUpperCase() + verbKey.slice(1);
  return withoutSuffix.replace(new RegExp(verbCamel + '$', 'i'), '');
}

function findTriggerEndpoint(verb, producerName, modulesConfig) {
  if (!verb) return null;
  const mod = modulesConfig.find((m) => m.name === producerName);
  if (!mod) return null;
  return (mod.exposes || []).find((ep) => {
    const uc = ep.useCase || '';
    return uc.toLowerCase().startsWith(verb.toLowerCase()) || uc.includes(verb);
  }) || null;
}

function buildEventFlows(systemConfig, modulesMap) {
  const asyncEvents = (systemConfig.integrations || {}).async || [];
  const syncIntegrations = (systemConfig.integrations || {}).sync || [];
  const modulesConfig = systemConfig.modules || [];

  const flows = [];

  for (const ev of asyncEvents) {
    const verb = extractEventVerb(ev.event);
    const subject = extractEventSubject(ev.event);
    const triggerEndpoint = findTriggerEndpoint(verb, ev.producer, modulesConfig);

    const producerMod = modulesMap[ev.producer] || { color: '#888888', label: ev.producer, icon: '📁' };
    const consumers = (ev.consumers || []).map((c) => (typeof c === 'string' ? c : c.module));

    // Find sync calls made by this producer module that might be part of this action
    const producerSyncCalls = syncIntegrations.filter((s) => s.caller === ev.producer);

    const steps = [];

    // Step 1: HTTP trigger (from client to producer)
    if (triggerEndpoint) {
      const syncCallsForStep = producerSyncCalls.map((s) => ({
        to: s.calls,
        label: (s.using || [])[0] || `GET /${s.calls}`,
        port: s.port,
      }));
      steps.push({
        id: 1,
        type: 'http',
        from: 'client',
        to: ev.producer,
        label: `${triggerEndpoint.method} ${triggerEndpoint.path}`,
        desc: triggerEndpoint.description || `${verb} ${subject}`,
        syncCalls: syncCallsForStep.length > 0 ? syncCallsForStep : undefined,
      });
    } else {
      steps.push({
        id: 1,
        type: 'http',
        from: 'client',
        to: ev.producer,
        label: `${verb || 'trigger'} /${subject.toLowerCase()}`,
        desc: `Acción que desencadena el evento`,
      });
    }

    // Step 2: Kafka event
    steps.push({
      id: 2,
      type: 'event',
      from: ev.producer,
      event: ev.event,
      topic: ev.topic,
      to: consumers,
      desc: `${ev.event} publicado en Kafka (topic: ${ev.topic})`,
    });

    // Step 3+: Consumer actions
    for (let i = 0; i < consumers.length; i++) {
      const consumer = consumers[i];
      const consumerMod = modulesConfig.find((m) => m.name === consumer);
      // Find a likely endpoint that the consumer would trigger on receiving this event
      let actionLabel = `Procesa ${ev.event}`;
      if (consumerMod) {
        const verbLower = (verb || '').toLowerCase();
        const match = (consumerMod.exposes || []).find((ep) => {
          const uc = (ep.useCase || '').toLowerCase();
          const method = (ep.method || '').toUpperCase();
          return (uc.includes(verbLower) || uc.includes(subject.toLowerCase())) &&
            (method === 'PUT' || method === 'PATCH' || method === 'POST');
        });
        if (match) {
          actionLabel = `${match.useCase} (${match.method} ${match.path})`;
        }
      }
      steps.push({
        id: i + 3,
        type: 'action',
        from: consumer,
        to: consumer,
        label: actionLabel,
        desc: `${consumer} reacciona al evento ${ev.event}`,
      });
    }

    flows.push({
      id: ev.event,
      label: ev.event.replace(/Event$/, '').replace(/([A-Z])/g, ' $1').trim(),
      icon: producerMod.icon || '📨',
      description: `${ev.producer} → [${consumers.join(', ')}] vía topic ${ev.topic}`,
      color: producerMod.color,
      steps,
    });
  }

  return flows;
}

// ── Temporal helpers ──────────────────────────────────────────────────────────

function _camelCase(str) {
  if (!str) return '';
  return str.replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toLowerCase());
}
function _pascalCase(str) {
  if (!str) return '';
  const c = _camelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * Infers a human-readable role description for an activity step.
 * Priority: domain.yaml description → auto-infer from name + type context.
 */
function inferActivityRole(actName, actDef, step, wfContext) {
  if (actDef && actDef.description) return actDef.description;

  const name = (actName || '').toLowerCase();
  const isCompensation = actDef && actDef.isCompensation;

  // Compensation activities
  if (isCompensation || /^(release|refund|cancel|undo|revert|restore|rollback|mark.*cancel)/i.test(actName)) {
    return `COMPENSATE: Deshace los efectos de la actividad principal en caso de fallo del workflow`;
  }
  // Async notification activities
  if (step && step.type === 'async') {
    return `NOTIFY: Envía notificación async (fire-and-forget) — no bloquea el workflow`;
  }
  // Read activities
  if (/^(get|find|fetch|load|read|query|search|list)/i.test(actName)) {
    const target = _pascalCase((step && step.target) || '');
    return `READ: Obtiene datos de ${target} necesarios para los pasos siguientes del workflow`;
  }
  // Write activities
  if (/^(create|make|build|generate|init)/i.test(actName)) {
    const target = _pascalCase((step && step.target) || '');
    return `WRITE: Crea un nuevo recurso en ${target}`;
  }
  if (/^(confirm|approve|activate|enable|process|execute)/i.test(actName)) {
    const target = _pascalCase((step && step.target) || '');
    return `WRITE: Confirma o actualiza estado en ${target}`;
  }
  if (/^(reserve|block|lock|hold|schedule|assign)/i.test(actName)) {
    const target = _pascalCase((step && step.target) || '');
    return `WRITE: Reserva o bloquea recurso en ${target}`;
  }
  if (/^(clear|clean|remove|purge|convert|mark)/i.test(actName)) {
    const target = _pascalCase((step && step.target) || '');
    return `WRITE: Actualiza o limpia datos en ${target}`;
  }

  return `Ejecuta lógica de negocio en módulo '${_pascalCase((step && step.target) || '')}'`;
}

/**
 * Classifies an activity step into one of: READ / WRITE / COMPENSATE / NOTIFY
 */
function classifyActivityRole(actName, actDef, step) {
  if (actDef && actDef.isCompensation) return 'COMPENSATE';
  if (/^(release|refund|cancel|undo|revert|restore|rollback|mark.*cancel)/i.test(actName)) return 'COMPENSATE';
  if (step && step.type === 'async') return 'NOTIFY';
  if (/^(get|find|fetch|load|read|query|search|list)/i.test(actName)) return 'READ';
  if (/^(notify|send|emit|alert|push|broadcast)/i.test(actName)) return 'NOTIFY';
  return 'WRITE';
}

/**
 * Calculates the LIFO compensation chain for a saga workflow.
 * Returns an array of { stepNum, activityName, compensationName, targetModule, type }
 * ordered chronologically (execution order); the LIFO rollback is the reverse.
 */
function buildSagaChain(wf) {
  const steps = Array.isArray(wf.steps) ? wf.steps : [];
  const chain = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.activity) continue;
    chain.push({
      stepNum: i + 1,
      activityName: step.activity,
      compensationName: step.compensation || null,
      targetModule: step.target || null,
      type: step.type || 'sync',
      timeout: step.timeout || null,
      isCompensable: !!(step.compensation),
      canFail: step.type !== 'async',
    });
  }
  return chain;
}

/**
 * Resolves the source of each input field in a step:
 * 'trigger' | 'step N: ActivityName' | 'unknown'
 */
function resolveInputSources(allSteps, currentIdx, triggerFields) {
  const inputSources = {};
  const available = {}; // fieldName → source label

  // Seed with trigger/event fields
  for (const f of triggerFields) {
    available[f] = 'trigger';
  }

  for (let i = 0; i < currentIdx; i++) {
    const prev = allSteps[i];
    for (const o of (prev.output || [])) {
      const oName = typeof o === 'string' ? o : o.name;
      if (oName) available[oName] = `paso ${i + 1}: ${prev.activity}`;
    }
  }

  const current = allSteps[currentIdx];
  for (const inp of (current.input || [])) {
    const iName = typeof inp === 'string' ? inp : inp.name;
    if (iName) inputSources[iName] = available[iName] || 'no resuelto';
  }

  return inputSources;
}

/**
 * Builds which downstream steps consume each output field of a given step.
 */
function buildOutputConsumers(allSteps, currentIdx) {
  const current = allSteps[currentIdx];
  const consumers = {};
  const outputs = (current.output || []).map((o) => (typeof o === 'string' ? o : o.name)).filter(Boolean);

  for (const outField of outputs) {
    consumers[outField] = [];
    for (let j = currentIdx + 1; j < allSteps.length; j++) {
      const downstep = allSteps[j];
      const inputs = (downstep.input || []).map((i) => (typeof i === 'string' ? i : i.name));
      if (inputs.includes(outField)) {
        consumers[outField].push(`paso ${j + 1}: ${downstep.activity}`);
      }
    }
  }
  return consumers;
}

/**
 * Calculates the module role based on its participation in workflows.
 * Orchestrator: has trigger module; DataProvider: only read activities; Executor: write/compensate; Reactor: only async/notify
 */
function calculateModuleRoles(systemConfig, domainConfigs) {
  const roles = {};
  const rawWorkflows = systemConfig.workflows || [];
  const modules = systemConfig.modules || [];

  for (const mod of modules) {
    const modName = _camelCase(mod.name);
    roles[modName] = { name: modName, roles: new Set(), label: mod.name };
  }

  for (const wf of rawWorkflows) {
    const trigMod = wf.trigger && wf.trigger.module ? _camelCase(wf.trigger.module) : null;
    if (trigMod && roles[trigMod]) roles[trigMod].roles.add('Orchestrator');

    for (const step of (wf.steps || [])) {
      const targetMod = step.target ? _camelCase(step.target) : trigMod;
      if (!targetMod || !roles[targetMod]) continue;

      const actName = (step.activity || '').toLowerCase();
      if (step.type === 'async') {
        roles[targetMod].roles.add('Reactor');
      } else if (/^(get|find|fetch|load|read|query|search|list)/.test(actName)) {
        roles[targetMod].roles.add('DataProvider');
      } else {
        roles[targetMod].roles.add('Executor');
      }
    }
  }

  // Convert Sets to sorted arrays
  const result = {};
  for (const [modName, data] of Object.entries(roles)) {
    const rolesArr = [...data.roles];
    result[modName] = {
      name: modName,
      label: data.label,
      roles: rolesArr,
      primaryRole: rolesArr.includes('Orchestrator') ? 'Orchestrator'
        : rolesArr.includes('Executor') ? 'Executor'
        : rolesArr.includes('DataProvider') ? 'DataProvider'
        : rolesArr.includes('Reactor') ? 'Reactor'
        : 'Standalone',
      roleLabel: rolesArr.length > 0 ? rolesArr.join(' + ') : 'Standalone',
    };
  }
  return result;
}

/**
 * Builds the activity catalog: all activities across all modules with usage info.
 */
function buildActivityCatalog(systemConfig, domainConfigs, modulesMap) {
  const rawWorkflows = systemConfig.workflows || [];
  const localWorkflowsByModule = {};

  // Collect local workflows
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (domainCfg && Array.isArray(domainCfg.workflows)) {
      localWorkflowsByModule[_camelCase(modName)] = domainCfg.workflows;
    }
  }

  // Build used-in index: "modName::ActivityName" → ["WorkflowName", ...]
  const usedIn = {};
  for (const wf of rawWorkflows) {
    const trigMod = wf.trigger && wf.trigger.module ? _camelCase(wf.trigger.module) : null;
    for (const step of (wf.steps || [])) {
      if (!step.activity) continue;
      const targetMod = step.target ? _camelCase(step.target) : trigMod;
      const key = `${targetMod}::${_pascalCase(step.activity)}`;
      if (!usedIn[key]) usedIn[key] = [];
      usedIn[key].push(wf.name);

      if (step.compensation) {
        const compKey = `${targetMod}::${_pascalCase(step.compensation)}`;
        if (!usedIn[compKey]) usedIn[compKey] = [];
        usedIn[compKey].push(`${wf.name} (compensation)`);
      }
    }
  }
  for (const [modName, localWfs] of Object.entries(localWorkflowsByModule)) {
    for (const wf of localWfs) {
      for (const step of (wf.steps || [])) {
        if (!step.activity) continue;
        const key = `${modName}::${_pascalCase(step.activity)}`;
        if (!usedIn[key]) usedIn[key] = [];
        usedIn[key].push(`${wf.name} (local)`);
      }
    }
  }

  // Build catalog entries
  const catalog = [];
  let compensationNames = new Set();

  // First pass: collect compensation names
  for (const [, domainCfg] of Object.entries(domainConfigs)) {
    for (const act of (domainCfg?.activities || [])) {
      if (act.compensation) compensationNames.add(_pascalCase(act.compensation));
    }
  }

  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (!domainCfg || !Array.isArray(domainCfg.activities)) continue;
    const modKey = _camelCase(modName);

    for (const act of domainCfg.activities) {
      const actPascal = _pascalCase(act.name);
      const key = `${modKey}::${actPascal}`;
      const usedInWorkflows = usedIn[key] || [];
      const isCompensation = compensationNames.has(actPascal);
      const role = classifyActivityRole(act.name, { isCompensation }, null);

      catalog.push({
        name: actPascal,
        module: modKey,
        moduleLabel: modulesMap[modKey]?.label || modKey,
        type: (act.type || 'light').toLowerCase(),
        role,
        description: act.description || inferActivityRole(act.name, { isCompensation }, null, {}),
        usedInWorkflows,
        isCompensation,
        isOrphan: usedInWorkflows.length === 0,
        hasRetryPolicy: !!(act.retryPolicy),
        retryPolicy: act.retryPolicy || null,
        timeout: act.timeout || null,
        inputFields: (act.input || []).map((f) => (typeof f === 'string' ? { name: f, type: 'String' } : f)),
        outputFields: (act.output || []).map((f) => (typeof f === 'string' ? { name: f, type: 'String' } : f)),
        hasOutput: !!(act.output && act.output.length > 0),
        nestedTypes: act.nestedTypes || [],
        externalTypes: act.externalTypes || [],
        compensation: act.compensation || null,
      });
    }
  }

  return catalog;
}

/**
 * Builds the external type dependency graph.
 * Returns array of { consumerModule, activityName, typeName, sourceModule }
 */
function buildExternalTypeDeps(domainConfigs) {
  const deps = [];
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (!domainCfg || !Array.isArray(domainCfg.activities)) continue;
    for (const act of domainCfg.activities) {
      for (const ext of (act.externalTypes || [])) {
        deps.push({
          consumerModule: _camelCase(modName),
          activityName: _pascalCase(act.name),
          typeName: _pascalCase(ext.name || ext),
          sourceModule: _camelCase(ext.module || ext),
        });
      }
    }
  }
  return deps;
}

/**
 * Builds queue topology for each module.
 */
function buildQueueTopology(systemConfig, domainConfigs) {
  const rawWorkflows = systemConfig.workflows || [];
  const modules = systemConfig.modules || [];
  const topology = {};

  const participating = new Set();
  for (const wf of rawWorkflows) {
    if (wf.trigger && wf.trigger.module) participating.add(_camelCase(wf.trigger.module));
    for (const step of (wf.steps || [])) {
      if (step.target) participating.add(_camelCase(step.target));
    }
  }
  // Also modules with activities[] in domain.yaml
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (domainCfg && Array.isArray(domainCfg.activities) && domainCfg.activities.length > 0) {
      participating.add(_camelCase(modName));
    }
    if (domainCfg && Array.isArray(domainCfg.workflows) && domainCfg.workflows.length > 0) {
      participating.add(_camelCase(modName));
    }
  }

  for (const mod of modules) {
    const modKey = _camelCase(mod.name);
    if (!participating.has(modKey)) continue;
    const snake = mod.name.toUpperCase().replace(/-/g, '_');
    topology[modKey] = {
      name: modKey,
      label: mod.name,
      flowQueue: `${snake}_WORKFLOW_QUEUE`,
      heavyQueue: `${snake}_HEAVY_TASK_QUEUE`,
      lightQueue: `${snake}_LIGHT_TASK_QUEUE`,
    };
  }

  return topology;
}

/**
 * Enriches workflows with resolved data flow, role descriptions and saga analysis.
 */
function enrichWorkflows(rawWorkflows, domainConfigs, modulesMap) {
  const activityDefs = {};
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (!domainCfg || !Array.isArray(domainCfg.activities)) continue;
    const modKey = _camelCase(modName);
    const compensationNames = new Set();
    for (const act of domainCfg.activities) {
      if (act.compensation) compensationNames.add(_pascalCase(act.compensation));
    }
    for (const act of domainCfg.activities) {
      activityDefs[`${modKey}::${_pascalCase(act.name)}`] = {
        ...act,
        isCompensation: compensationNames.has(_pascalCase(act.name)),
      };
    }
  }

  return rawWorkflows.map((wf) => {
    const triggerModule = wf.trigger && wf.trigger.module ? _camelCase(wf.trigger.module) : null;
    const steps = Array.isArray(wf.steps) ? wf.steps : [];

    // Approximate trigger fields from domain events
    const triggerFields = [];
    if (wf.trigger && wf.trigger.on && triggerModule && domainConfigs[triggerModule]) {
      const domainCfg = domainConfigs[triggerModule];
      for (const agg of (domainCfg.aggregates || [])) {
        for (const ev of (agg.events || [])) {
          const evLower = (ev.name || '').toLowerCase().replace(/event$/, '');
          const trigLower = (wf.trigger.on || '').toLowerCase().replace(/event$/, '');
          if (evLower.includes(trigLower) || trigLower.includes(evLower)) {
            for (const f of (ev.fields || [])) {
              if (f && f.name) triggerFields.push(f.name);
            }
          }
        }
      }
    }

    const enrichedSteps = steps.map((step, idx) => {
      if (!step.activity) return { ...step, _stepNum: idx + 1, _isWait: true };

      const actPascal = _pascalCase(step.activity);
      const targetMod = step.target ? _camelCase(step.target) : triggerModule;
      const actKey = `${targetMod}::${actPascal}`;
      const actDef = activityDefs[actKey] || null;

      const modInfo = modulesMap[targetMod] || { label: targetMod, icon: '📁', color: '#888' };
      const roleClass = classifyActivityRole(step.activity, actDef, step);
      const roleDesc = inferActivityRole(step.activity, actDef, step, { wfName: wf.name });
      const inputSources = resolveInputSources(steps, idx, triggerFields);
      const outputConsumers = buildOutputConsumers(steps, idx);

      return {
        _stepNum: idx + 1,
        _isWait: false,
        activity: step.activity,
        activityPascal: actPascal,
        target: targetMod,
        targetLabel: modInfo.label,
        targetIcon: modInfo.icon,
        targetColor: modInfo.color,
        type: step.type || 'sync',
        activityType: (actDef && actDef.type) ? actDef.type.toLowerCase() : 'light',
        timeout: step.timeout || null,
        retryPolicy: (actDef && actDef.retryPolicy) || null,
        compensation: step.compensation || null,
        roleClass,
        roleDesc,
        inputs: (step.input || []).map((f) => {
          const fName = typeof f === 'string' ? f : f.name;
          return { name: fName, source: inputSources[fName] || 'trigger' };
        }),
        outputs: (step.output || []).map((f) => {
          const fName = typeof f === 'string' ? f : f.name;
          return { name: fName, consumers: outputConsumers[fName] || [] };
        }),
        formalOutputCount: actDef ? (actDef.output || []).length : 0,
      };
    });

    const sagaChain = wf.saga === true ? buildSagaChain(wf) : null;

    // Build data flow table: columns = steps (sync only), rows = all field names
    const dataFlowFields = new Set();
    const dataFlowSources = {}; // fieldName → { origin: 'trigger'|stepIdx, label }
    for (const f of triggerFields) {
      dataFlowFields.add(f);
      dataFlowSources[f] = { origin: 'trigger', label: 'trigger' };
    }
    for (let i = 0; i < enrichedSteps.length; i++) {
      for (const o of (enrichedSteps[i].outputs || [])) {
        if (o.name) {
          dataFlowFields.add(o.name);
          dataFlowSources[o.name] = { origin: i, label: `paso ${i + 1}: ${steps[i].activity}` };
        }
      }
    }

    const dataFlowTable = [...dataFlowFields].map((field) => {
      const source = dataFlowSources[field] || { origin: 'trigger', label: 'trigger' };
      const consumed = enrichedSteps
        .map((s, idx) => ({ idx, step: s }))
        .filter(({ step }) => (step.inputs || []).some((inp) => inp.name === field))
        .map(({ idx, step }) => ({ stepNum: idx + 1, activity: step.activity || '(wait)' }));
      return { field, source: source.label, consumed };
    });

    return {
      name: wf.name,
      trigger: wf.trigger || null,
      triggerModule,
      triggerModuleLabel: modulesMap[triggerModule]?.label || triggerModule,
      triggerModuleIcon: modulesMap[triggerModule]?.icon || '📁',
      triggerModuleColor: modulesMap[triggerModule]?.color || '#888',
      saga: wf.saga === true,
      taskQueue: wf.taskQueue || null,
      steps: enrichedSteps,
      sagaChain,
      dataFlowTable,
      triggerFields,
      stepCount: steps.length,
      asyncStepCount: steps.filter((s) => s.type === 'async').length,
      compensableStepCount: steps.filter((s) => !!s.compensation).length,
    };
  });
}

/**
 * Main Temporal report data extraction function.
 * Returns the full temporalData object passed to the HTML template.
 */
function extractTemporalReportData(systemConfig, domainConfigs, modulesMap) {
  const rawWorkflows = systemConfig.workflows || [];
  const orchestration = systemConfig.orchestration || {};

  const moduleRoles = calculateModuleRoles(systemConfig, domainConfigs);
  const activityCatalog = buildActivityCatalog(systemConfig, domainConfigs, modulesMap);
  const externalTypeDeps = buildExternalTypeDeps(domainConfigs);
  const queueTopology = buildQueueTopology(systemConfig, domainConfigs);
  const workflows = enrichWorkflows(rawWorkflows, domainConfigs, modulesMap);

  // Local workflows (from individual domain.yaml files)
  const localWorkflows = [];
  for (const [modName, domainCfg] of Object.entries(domainConfigs)) {
    if (!domainCfg || !Array.isArray(domainCfg.workflows)) continue;
    const modKey = _camelCase(modName);
    for (const wf of domainCfg.workflows) {
      const enriched = enrichWorkflows([wf], domainConfigs, modulesMap)[0];
      localWorkflows.push({ ...enriched, _ownerModule: modKey, _ownerLabel: modulesMap[modKey]?.label || modKey, _isLocal: true });
    }
  }

  // Saga workflows only
  const sagaWorkflows = workflows.filter((wf) => wf.saga);

  return {
    isTemporalMode: true,
    orchestration: {
      target: orchestration.temporal?.target || 'localhost:7233',
      namespace: orchestration.temporal?.namespace || 'default',
      engine: 'temporal',
    },
    workflows,
    localWorkflows,
    sagaWorkflows,
    activityCatalog,
    moduleRoles,
    externalTypeDeps,
    queueTopology,
  };
}

// ── Data extraction ──────────────────────────────────────────────────────────

// Builds the shared color/icon modules map used by multiple extractors
function buildModulesMap(systemConfig) {
  const modulesConfig = systemConfig.modules || [];
  const modulesMap = {};
  for (let i = 0; i < modulesConfig.length; i++) {
    const mod = modulesConfig[i];
    const key = _camelCase(mod.name);
    modulesMap[key] = {
      id: mod.name,
      label: toPascalCase(mod.name),
      icon: assignIcon(mod.name),
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
      desc: mod.description || mod.name,
    };
    // Also index by raw name for compatibility
    if (mod.name !== key) {
      modulesMap[mod.name] = modulesMap[key];
    }
  }
  return modulesMap;
}

function extractReportData(systemConfig, validation, domainValidation) {
  const modulesConfig = systemConfig.modules || [];
  const asyncEvents = (systemConfig.integrations || {}).async || [];
  const syncIntegrations = (systemConfig.integrations || {}).sync || [];

  // Build modules map with color + icon
  const modulesMap = buildModulesMap(systemConfig);

  // Normalize events (consumers can be strings or objects with .module)
  const events = asyncEvents.map((ev) => ({
    event: ev.event,
    producer: ev.producer,
    topic: ev.topic,
    consumers: (ev.consumers || []).map((c) => (typeof c === 'string' ? c : c.module)),
  }));

  // Normalize sync integrations
  const syncList = syncIntegrations.map((s) => ({
    caller: s.caller,
    calls: s.calls,
    port: s.port || `${toPascalCase(s.calls)}Service`,
    endpoints: s.using || [],
  }));

  // Build endpoints per module
  const endpoints = {};
  for (const mod of modulesConfig) {
    endpoints[mod.name] = (mod.exposes || []).map((ep) => `${ep.method} ${ep.path}`);
  }

  // Auto-generate flows
  const flows = buildEventFlows(systemConfig, modulesMap);

  // Deduplicate modules by id (buildModulesMap indexes both camelCase and raw-name keys,
  // so Object.values() can return the same module object twice for hyphenated names like "shopping-carts")
  const seenModIds = new Set();
  const modulesList = Object.values(modulesMap).filter((m) => {
    if (seenModIds.has(m.id)) return false;
    seenModIds.add(m.id);
    return true;
  });

  return {
    systemName: (systemConfig.system || {}).name || 'eva4j system',
    modules: modulesList,
    events,
    syncIntegrations: syncList,
    endpoints,
    flows,
    validation,
    domainValidation,
    generatedAt: new Date().toISOString(),
  };
}

// ── Command ──────────────────────────────────────────────────────────────────

async function evaluateSystemCommand(type, options = {}) {
  if (type !== 'system') {
    console.error(chalk.red(`❌ Unknown evaluation type: '${type}'`));
    console.log(chalk.gray("Usage: eva evaluate system"));
    console.log(chalk.gray("Only 'system' is supported at this time."));
    process.exit(1);
  }

  const port = parseInt(options.port || '3000', 10);
  const outputPath = path.resolve(process.cwd(), options.output || './system-report.html');

  // ── 1. Read system.yaml ─────────────────────────────────────────────────
  const systemYamlPath = path.join(process.cwd(), 'system', 'system.yaml');
  if (!(await fs.pathExists(systemYamlPath))) {
    console.error(chalk.red('❌ system/system.yaml not found'));
    console.error(chalk.gray('Run this command from the root of an eva4j project'));
    console.error(chalk.gray('Expected location: system/system.yaml'));
    process.exit(1);
  }

  let systemConfig;
  try {
    const content = await fs.readFile(systemYamlPath, 'utf-8');
    systemConfig = yaml.load(content);
  } catch (err) {
    console.error(chalk.red('❌ Failed to parse system/system.yaml:'), err.message);
    process.exit(1);
  }

  const spinner = ora('Analyzing system/system.yaml...').start();

  // ── 2a. Load domain YAMLs (needed by both system and domain validation) ──
  const domainConfigs = {};
  let domainValidation = null;
  const systemDir = path.join(process.cwd(), 'system');
  let allFiles;
  try {
    allFiles = await fs.readdir(systemDir);
  } catch {
    allFiles = [];
  }
  const domainFiles = allFiles.filter((f) => f.endsWith('.yaml') && f !== 'system.yaml');

  if (domainFiles.length === 0) {
    console.warn(chalk.yellow('⚠  No domain YAML files found in system/ (excluding system.yaml). Domain tab will be hidden.'));
  } else {
    for (const file of domainFiles) {
      const moduleName = path.basename(file, '.yaml');
      try {
        const content = await fs.readFile(path.join(systemDir, file), 'utf-8');
        domainConfigs[moduleName] = yaml.load(content) || {};
      } catch (err) {
        console.warn(chalk.yellow(`⚠  Could not parse ${file}: ${err.message}`));
      }
    }
  }

  // ── 2b. Run system validation (receives domainConfigs to cross-check) ───
  const validation = validateSystem(systemConfig, domainConfigs);

  // ── 2c. Run domain validation ───────────────────────────────────────────
  if (Object.keys(domainConfigs).length > 0) {
    domainValidation = validateDomain(domainConfigs, systemConfig);
  }

  // ── 3. Detect orchestration engine + extract report data ────────────────
  const orchestration = systemConfig.orchestration || {};
  const isTemporalMode = !!(orchestration.enabled && orchestration.engine === 'temporal');

  const reportData = extractReportData(systemConfig, validation, domainValidation);
  reportData.isTemporalMode = isTemporalMode;

  if (isTemporalMode) {
    const modulesMap = buildModulesMap(systemConfig);
    const temporalCtx = extractTemporalReportData(systemConfig, domainConfigs, modulesMap);
    const temporalValidation = validateTemporal(systemConfig, domainConfigs, temporalCtx);

    Object.assign(reportData, {
      orchestration: temporalCtx.orchestration,
      workflows: temporalCtx.workflows,
      localWorkflows: temporalCtx.localWorkflows,
      sagaWorkflows: temporalCtx.sagaWorkflows,
      activityCatalog: temporalCtx.activityCatalog,
      moduleRoles: temporalCtx.moduleRoles,
      externalTypeDeps: temporalCtx.externalTypeDeps,
      queueTopology: temporalCtx.queueTopology,
      temporalValidation,
    });

    if (temporalValidation) {
      console.log();
      console.log(chalk.bold('⏱️  Temporal Validation'));
      console.log(chalk.gray('─'.repeat(40)));
      const tv = temporalValidation.summary;
      console.log(`  ${chalk.red('🔴 Errors:')}     ${chalk.red.bold(tv.errors)}`);
      console.log(`  ${chalk.yellow('🟡 Warnings:')}   ${chalk.yellow.bold(tv.warnings)}`);
      console.log(`  ${chalk.cyan('🔵 Info:')}       ${chalk.cyan.bold(tv.info)}`);
      console.log(`  ${chalk.green('🟢 OK:')}         ${chalk.green.bold(tv.ok)}`);
    }
  }

  // ── 4. Render HTML ──────────────────────────────────────────────────────
  const templatePath = path.join(__dirname, '../../templates/evaluate/report.html.ejs');
  let htmlContent;
  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    htmlContent = ejs.render(templateContent, { data: reportData });
  } catch (err) {
    spinner.fail('Failed to render HTML template');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── 5. Write HTML file ──────────────────────────────────────────────────
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, htmlContent, 'utf-8');

  // ── 5b. Write domain assets ───────────────────────────────────────────────
  if (domainValidation) {
    await writeDomainAssets(domainValidation, process.cwd());
  }

  // ── 5c. Write system-evaluation.md ──────────────────────────────────────
  const evalMdPath = path.resolve(process.cwd(), 'assets', 'system-evaluation.md');
  await fs.ensureDir(path.dirname(evalMdPath));
  await writeSystemEvaluation(validation, systemConfig, evalMdPath);

  spinner.succeed(chalk.green('Analysis complete!'));

  // ── 6. Print validation summary ─────────────────────────────────────────
  console.log();
  console.log(chalk.bold('📊 Validation Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(
    `  ${chalk.red('🔴 Errors:')}     ${chalk.red.bold(validation.errors.length)}`
  );
  console.log(
    `  ${chalk.yellow('🟡 Warnings:')}   ${chalk.yellow.bold(validation.warnings.length)}`
  );
  console.log(
    `  ${chalk.cyan('🔵 Info:')}       ${chalk.cyan.bold((validation.info || []).length)}`
  );
  console.log(
    `  ${chalk.green('🟢 Passed:')}     ${chalk.green.bold(validation.ok.length)}`
  );
  console.log(
    `  ${chalk.blue('📈 Score:')}      ${chalk.blue.bold(validation.score + '%')}`
  );
  console.log();

  if (validation.errors.length > 0) {
    console.log(chalk.red('Critical issues found:'));
    validation.errors.forEach((e) => console.log(chalk.red(`  • ${e}`)));
    console.log();
  }

  if (validation.warnings.length > 0) {
    console.log(chalk.yellow('Warnings:'));
    validation.warnings.forEach((w) => console.log(chalk.yellow(`  • ${w}`)));
    console.log();
  }

  if ((validation.info || []).length > 0) {
    console.log(chalk.cyan('Info:'));
    validation.info.forEach((i) => console.log(chalk.cyan(`  • ${i}`)));
    console.log();
  }

  // ── 6b. Print domain validation summary ────────────────────────────────
  if (domainValidation) {
    const ds = domainValidation.summary;
    console.log(chalk.bold('🏛️  Domain Validation Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  ${chalk.red('🔴 Errors:')}     ${chalk.red.bold(ds.errors)}`);
    console.log(`  ${chalk.yellow('🟡 Warnings:')}   ${chalk.yellow.bold(ds.warnings)}`);
    console.log(`  ${chalk.blue('🔵 Info:')}       ${chalk.blue.bold(ds.info)}`);
    console.log(`  ${chalk.green('🟢 OK:')}         ${chalk.green.bold(ds.ok)}`);
    console.log();
  }

  // ── 7. Start HTTP server ─────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
  });

  server.listen(port, () => {
    console.log(chalk.gray(`Report written to: ${outputPath}`));
    console.log(chalk.gray(`Evaluation written to: assets/system-evaluation.md`));
    console.log();
    console.log(chalk.bold.green(`🌐 Server running at: http://localhost:${port}`));
    console.log(chalk.gray('Open the URL in your browser to view the report'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`❌ Port ${port} is already in use. Try --port <other-port>`));
    } else {
      console.error(chalk.red('❌ Server error:'), err.message);
    }
    process.exit(1);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeSystemEvaluation(validation, systemConfig, filePath) {
  const systemName = (systemConfig.system || {}).name || 'eva4j system';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const scoreLabel = validation.score > 80 ? '🟢 Bueno' : validation.score > 60 ? '🟡 Aceptable' : '🔴 Crítico';

  const lines = [];

  lines.push(`# Evaluación del sistema — ${systemName}`);
  lines.push('');
  lines.push(`> Generado: ${now}  `);
  lines.push(`> Score de calidad: **${validation.score}%** ${scoreLabel}  `);
  lines.push(`> 🔴 Errores: ${validation.errors.length} | 🟡 Advertencias: ${validation.warnings.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (validation.errors.length > 0) {
    lines.push('## 🔴 Errores críticos');
    lines.push('');
    for (const e of validation.errors) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('## 🟡 Advertencias');
    lines.push('');
    for (const w of validation.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    lines.push('## ✅ Sin errores ni advertencias');
    lines.push('');
    lines.push('El sistema supera todas las validaciones de errores y advertencias.');
    lines.push('');
  }

  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

function toPascalCase(str) {
  return str
    .replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (c) => c.toUpperCase());
}

// ── writeDomainAssets ─────────────────────────────────────────────────────────
async function writeDomainAssets(domainValidation, cwd) {
  const assetsDir = path.join(cwd, 'assets', 'evaluation');
  await fs.ensureDir(assetsDir);

  const { categories, diagrams, blueprints, summary } = domainValidation;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // ── 1. Write per-module .mmd files ──────────────────────────────────────
  if (diagrams) {
    for (const [moduleName, diagramText] of Object.entries(diagrams)) {
      if (diagramText) {
        await fs.writeFile(path.join(assetsDir, `${moduleName}.mmd`), diagramText, 'utf-8');
      }
    }
  }

  // ── 1b. Write per-module blueprint .mmd files ───────────────────────────
  if (blueprints) {
    for (const [moduleName, blueprintText] of Object.entries(blueprints)) {
      if (blueprintText) {
        await fs.writeFile(path.join(assetsDir, `${moduleName}-blueprint.mmd`), blueprintText, 'utf-8');
      }
    }
  }

  // ── 2. Build evaluation.md ──────────────────────────────────────────────

  // Collect all findings grouped by module
  const byModule = {};
  for (const cat of categories) {
    for (const check of cat.checks) {
      for (const finding of check.findings) {
        const mod = finding.module || '(sin módulo)';
        if (!byModule[mod]) byModule[mod] = [];
        byModule[mod].push({
          category: `${cat.id} – ${cat.label}`,
          checkId: check.id,
          checkLabel: check.label,
          severity: check.severity,
          message: finding.message,
          context: finding.context || '',
        });
      }
    }
  }

  const SEV_EMOJI = { error: '🔴', warning: '🟡', info: '🔵', ok: '🟢' };

  const lines = [];
  lines.push(`# Domain Evaluation Report`);
  lines.push(`> Generated: ${now}`);
  lines.push('');

  // Summary table
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| 🔴 Errors | 🟡 Warnings | 🔵 Info | 🟢 OK |`);
  lines.push(`|-----------|-------------|---------|-------|`);
  lines.push(`| ${summary.errors} | ${summary.warnings} | ${summary.info} | ${summary.ok} |`);
  lines.push('');

  const moduleNames = Object.keys(byModule).sort();

  if (moduleNames.length === 0) {
    lines.push('_No findings detected across all modules._');
  } else {
    lines.push(`## Findings by Module`);
    lines.push('');

    for (const moduleName of moduleNames) {
      const findings = byModule[moduleName];
      const errorCount   = findings.filter(f => f.severity === 'error').length;
      const warningCount = findings.filter(f => f.severity === 'warning').length;
      const infoCount    = findings.filter(f => f.severity === 'info').length;

      const badges = [
        errorCount   ? `🔴 ${errorCount} error${errorCount   !== 1 ? 's' : ''}` : null,
        warningCount ? `🟡 ${warningCount} warning${warningCount !== 1 ? 's' : ''}` : null,
        infoCount    ? `🔵 ${infoCount} info` : null,
      ].filter(Boolean).join(' · ');

      lines.push(`### \`${moduleName}\`${badges ? `  <sub>${badges}</sub>` : ''}`);
      lines.push('');

      if (diagrams && diagrams[moduleName]) {
        lines.push(`> 📊 Diagram: [${moduleName}.mmd](./${moduleName}.mmd)`);
      }
      if (blueprints && blueprints[moduleName]) {
        lines.push(`> 🏗 Blueprint: [${moduleName}-blueprint.mmd](./${moduleName}-blueprint.mmd)`);
      }
      if ((diagrams && diagrams[moduleName]) || (blueprints && blueprints[moduleName])) {
        lines.push('');
      }

      lines.push(`| Severity | Check | Message | Context |`);
      lines.push(`|----------|-------|---------|---------|`);

      for (const f of findings) {
        const sev = `${SEV_EMOJI[f.severity] || ''} ${f.severity}`;
        const checkCell = `**${f.checkId}** ${f.checkLabel}`;
        const msg = f.message.replace(/\|/g, '\\|');
        const ctx = f.context.replace(/\|/g, '\\|');
        lines.push(`| ${sev} | ${checkCell} | ${msg} | ${ctx} |`);
      }
      lines.push('');
    }
  }

  // Modules with diagrams but no findings
  if (diagrams) {
    const cleanModules = Object.keys(diagrams)
      .filter(m => diagrams[m] && !byModule[m])
      .sort();
    if (cleanModules.length > 0) {
      lines.push(`## Clean Modules (no findings)`);
      lines.push('');
      for (const m of cleanModules) {
        const links = [`[${m}.mmd](./${m}.mmd)`];
        if (blueprints && blueprints[m]) links.push(`[${m}-blueprint.mmd](./${m}-blueprint.mmd)`);
        lines.push(`- \`${m}\` — 🟢 no findings · ${links.join(' · ')}`);
      }
      lines.push('');
    }
  }

  await fs.writeFile(path.join(assetsDir, 'evaluation.md'), lines.join('\n'), 'utf-8');

  const mmdFiles = diagrams ? Object.keys(diagrams).filter(m => diagrams[m]) : [];
  const bpFiles  = blueprints ? Object.keys(blueprints).filter(m => blueprints[m]) : [];
  console.log(chalk.gray(`  Domain assets → assets/evaluation/  (evaluation.md + ${mmdFiles.length} .mmd + ${bpFiles.length} blueprint files)`));
}

module.exports = evaluateSystemCommand;
