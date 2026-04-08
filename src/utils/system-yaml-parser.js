/**
 * system-yaml-parser.js
 *
 * Parses system.yaml and resolves cross-module workflow definitions by
 * cross-referencing each workflow step's activity with its target module's
 * domain.yaml. Produces a rich context tree for template generation.
 */

const yaml = require('js-yaml');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { toPascalCase, toCamelCase, toScreamingSnakeCase } = require('./naming');

// ─── Java type → import mapping (shared with generate-temporal-activity) ────
const JAVA_TYPE_IMPORTS = {
  BigDecimal: 'java.math.BigDecimal',
  LocalDateTime: 'java.time.LocalDateTime',
  LocalDate: 'java.time.LocalDate',
  LocalTime: 'java.time.LocalTime',
  Instant: 'java.time.Instant',
  UUID: 'java.util.UUID',
  List: 'java.util.List',
};

function resolveFieldImports(fields) {
  const imports = new Set();
  for (const field of fields) {
    for (const [type, imp] of Object.entries(JAVA_TYPE_IMPORTS)) {
      if (field.javaType && field.javaType.includes(type)) {
        imports.add(`import ${imp};`);
      }
    }
  }
  return Array.from(imports).sort();
}

function mapField(field) {
  let javaType = field.type || 'String';
  // Default bare collection types to generic <String>
  if (javaType === 'List' || javaType === 'Set') {
    javaType = javaType + '<String>';
  }
  return { name: field.name, javaType };
}

/**
 * Parse a timeout string like "5s", "10m", "2h" into a Duration descriptor.
 * @param {string|null} timeout
 * @returns {{ value: number, unit: string }}
 */
function parseTimeout(timeout) {
  if (!timeout) return { value: 30, unit: 'Seconds' };
  const match = String(timeout).match(/^(\d+)(s|m|h)$/);
  if (!match) return { value: 30, unit: 'Seconds' };
  const units = { s: 'Seconds', m: 'Minutes', h: 'Hours' };
  return { value: parseInt(match[1], 10), unit: units[match[2]] || 'Seconds' };
}

// ─── Core parser ────────────────────────────────────────────────────────────

/**
 * Load and parse system.yaml.
 * @param {string} systemYamlPath - Absolute path to system.yaml
 * @returns {object} Raw parsed YAML data
 */
async function loadSystemYaml(systemYamlPath) {
  if (!(await fs.pathExists(systemYamlPath))) {
    throw new Error(`system.yaml not found at ${systemYamlPath}`);
  }
  const content = await fs.readFile(systemYamlPath, 'utf-8');
  return yaml.load(content);
}

/**
 * Load the activities section from a module's domain.yaml.
 * @param {string} domainYamlPath - Absolute path to domain.yaml
 * @returns {Map<string, object>} Map of PascalCase activity name → raw activity definition
 */
async function loadModuleActivities(domainYamlPath) {
  const activities = new Map();
  if (!(await fs.pathExists(domainYamlPath))) return activities;

  const content = await fs.readFile(domainYamlPath, 'utf-8');
  const data = yaml.load(content);
  if (!data || !Array.isArray(data.activities)) return activities;

  for (const act of data.activities) {
    activities.set(toPascalCase(act.name), act);
  }
  return activities;
}

/**
 * Parse system.yaml and resolve all workflow steps against their target module
 * domain.yaml files.
 *
 * @param {string} systemDir - Directory containing system.yaml and domain yamls
 * @returns {object} Parsed system context:
 *   {
 *     system: { name, groupId, javaVersion, springBootVersion, database },
 *     orchestration: { enabled, engine, temporal: { target, namespace } },
 *     modules: [{ name, description, exposes }],
 *     workflows: [ResolvedWorkflow],
 *     activityRegistry: Map<activityName, { module, definition }>,
 *     warnings: string[]
 *   }
 */
async function parseSystemYaml(systemDir) {
  const systemYamlPath = path.join(systemDir, 'system.yaml');
  const data = await loadSystemYaml(systemYamlPath);

  const warnings = [];

  // ── 1. Basic sections ──────────────────────────────────────────────────
  const system = data.system || {};
  const orchestration = data.orchestration || {};
  const modules = Array.isArray(data.modules) ? data.modules : [];
  const rawWorkflows = Array.isArray(data.workflows) ? data.workflows : [];

  // ── 2. Load all module activities ──────────────────────────────────────
  // Map: moduleName (camelCase) → Map<ActivityPascalCase, rawDefinition>
  const moduleActivitiesMap = new Map();

  for (const mod of modules) {
    const modCamel = toCamelCase(mod.name);
    // Domain YAML files can be in the system dir (prototype layout)
    // or in the project's module directory. Try both.
    const candidates = [
      path.join(systemDir, `${mod.name}.yaml`),
      path.join(systemDir, `${modCamel}.yaml`),
    ];

    let activities = new Map();
    for (const candidate of candidates) {
      activities = await loadModuleActivities(candidate);
      if (activities.size > 0) break;
    }

    moduleActivitiesMap.set(modCamel, activities);
  }

  // ── 3. Build activity registry (flat, for easy lookup) ─────────────────
  // Map: activityPascalCase → { module (camelCase), definition, inputFields, outputFields }
  const activityRegistry = new Map();

  for (const [modName, activities] of moduleActivitiesMap) {
    for (const [actName, actDef] of activities) {
      activityRegistry.set(actName, {
        module: modName,
        definition: actDef,
        inputFields: Array.isArray(actDef.input) ? actDef.input.map(mapField) : [],
        outputFields: Array.isArray(actDef.output) ? actDef.output.map(mapField) : [],
        type: (actDef.type || 'light').toLowerCase(),
        compensation: actDef.compensation ? toPascalCase(actDef.compensation) : null,
        timeout: actDef.timeout || null,
        description: actDef.description || '',
      });
    }
  }

  // ── 4. Resolve workflows ───────────────────────────────────────────────
  const workflows = rawWorkflows.map((wf) =>
    resolveWorkflow(wf, activityRegistry, warnings)
  );

  return {
    system,
    orchestration,
    modules,
    workflows,
    activityRegistry,
    warnings,
  };
}

/**
 * Resolve a single workflow definition: enrich each step with activity
 * definitions, detect parallel groups, and derive the host module.
 *
 * @param {object} wf - Raw workflow from system.yaml
 * @param {Map} activityRegistry - Global activity lookup
 * @param {string[]} warnings - Mutable array for warnings
 * @returns {object} Resolved workflow
 */
function resolveWorkflow(wf, activityRegistry, warnings) {
  const name = wf.name;
  const namePascal = toPascalCase(name);
  const trigger = wf.trigger || {};
  const hostModule = toCamelCase(trigger.module || '');
  const taskQueue = wf.taskQueue || `${toScreamingSnakeCase(hostModule)}_WORKFLOW_QUEUE`;
  const isSaga = wf.saga === true;

  const steps = [];
  const rawSteps = Array.isArray(wf.steps) ? wf.steps : [];

  for (let i = 0; i < rawSteps.length; i++) {
    const rawStep = rawSteps[i];
    const activityName = toPascalCase(rawStep.activity);
    const targetModule = toCamelCase(rawStep.target || hostModule);
    const isLocal = targetModule === hostModule;
    const isAsync = rawStep.type === 'async';
    const isParallel = rawStep.parallel === true;
    const isOptional = rawStep.optional === true;

    // Resolve from registry
    const registered = activityRegistry.get(activityName);
    if (!registered) {
      warnings.push(
        `Workflow '${name}' step ${i + 1}: activity '${activityName}' not found in any module's domain.yaml`
      );
    }

    const inputFields = registered ? registered.inputFields : (rawStep.input || []).map((n) => ({ name: n, javaType: 'String' }));
    const outputFields = registered ? registered.outputFields : (rawStep.output || []).map((n) => ({ name: n, javaType: 'String' }));
    const actType = registered ? registered.type : (rawStep.type === 'async' ? 'light' : 'light');
    const timeout = rawStep.timeout || (registered ? registered.timeout : null);

    // Resolve compensation
    let compensation = null;
    if (rawStep.compensation) {
      const compName = toPascalCase(rawStep.compensation);
      const compRegistered = activityRegistry.get(compName);
      compensation = {
        name: compName,
        module: compRegistered ? compRegistered.module : targetModule,
        inputFields: compRegistered ? compRegistered.inputFields : [],
      };
    }

    // Queue for this step's target module
    const stepQueue = actType === 'heavy'
      ? `${toScreamingSnakeCase(targetModule)}_HEAVY_TASK_QUEUE`
      : `${toScreamingSnakeCase(targetModule)}_LIGHT_TASK_QUEUE`;

    // Raw field names from system.yaml (wiring-level names)
    const rawInputNames = Array.isArray(rawStep.input) ? rawStep.input : [];
    const rawOutputNames = Array.isArray(rawStep.output) ? rawStep.output : [];

    steps.push({
      index: i,
      activityName,
      activityCamel: activityName.charAt(0).toLowerCase() + activityName.slice(1),
      targetModule,
      targetModulePascal: toPascalCase(targetModule),
      targetModuleScreamingSnake: toScreamingSnakeCase(targetModule),
      stepQueue,
      isLocal,
      isAsync,
      isParallel,
      isOptional,
      actType,
      timeout,
      inputFields,
      outputFields,
      rawInputNames,
      rawOutputNames,
      hasInput: inputFields.length > 0,
      hasOutput: outputFields.length > 0,
      compensation,
      inputImports: resolveFieldImports(inputFields),
      outputImports: resolveFieldImports(outputFields),
    });
  }

  // ── Detect parallel groups ─────────────────────────────────────────────
  // Consecutive steps with parallel: true form a group
  const parallelGroups = [];
  let currentGroup = null;
  for (const step of steps) {
    if (step.isParallel) {
      if (!currentGroup) {
        currentGroup = { startIndex: step.index, steps: [] };
      }
      currentGroup.steps.push(step);
    } else {
      if (currentGroup) {
        parallelGroups.push(currentGroup);
        currentGroup = null;
      }
    }
  }
  if (currentGroup) parallelGroups.push(currentGroup);

  // ── Collect unique target modules (for imports) ────────────────────────
  const targetModules = [...new Set(steps.map((s) => s.targetModule))];

  return {
    name,
    namePascal,
    nameScreamingSnake: toScreamingSnakeCase(name.replace(/Workflow$/, '')),
    trigger,
    hostModule,
    hostModulePascal: toPascalCase(hostModule),
    hostModuleScreamingSnake: toScreamingSnakeCase(hostModule),
    taskQueue,
    isSaga,
    steps,
    parallelGroups,
    targetModules,
    hasParallelSteps: parallelGroups.length > 0,
    hasCompensations: steps.some((s) => s.compensation !== null),
    hasAsyncSteps: steps.some((s) => s.isAsync),
    hasOptionalSteps: steps.some((s) => s.isOptional),
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  parseSystemYaml,
  loadSystemYaml,
  loadModuleActivities,
  resolveWorkflow,
  resolveFieldImports,
  mapField,
  parseTimeout,
};
