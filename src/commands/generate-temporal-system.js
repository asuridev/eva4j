/**
 * generate-temporal-system.js
 *
 * New command: `eva g temporal-system`
 *
 * Reads system.yaml → workflows[], cross-references each step with its
 * target module's domain.yaml activities, and generates:
 *   1. Shared activity contracts (Interface + Input + Output) in shared/
 *   2. WorkFlowInterface + WorkFlowImpl + WorkFlowService + WorkFlowInput in host module
 *   3. Updates ModuleTemporalWorkerConfig
 *   4. Updates temporal.yaml with module queue sections
 */

const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toPascalCase, toCamelCase, toScreamingSnakeCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const ChecksumManager = require('../utils/checksum-manager');
const { parseSystemYaml, resolveFieldImports, parseTimeout } = require('../utils/system-yaml-parser');
const {
  generateSharedContracts,
  buildActivityContext,
  scanExistingSharedTypes,
} = require('./generate-temporal-activity');

async function generateTemporalSystemCommand(options = {}) {
  const projectDir = process.cwd();

  // ── Validations ─────────────────────────────────────────────────────────
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    process.exit(1);
  }

  const configManager = new ConfigManager(projectDir);

  if (!(await configManager.featureExists('temporal'))) {
    console.error(chalk.red('❌ Temporal client is not installed'));
    console.error(chalk.gray('Install Temporal first: eva add temporal-client'));
    process.exit(1);
  }

  const projectConfig = await configManager.loadProjectConfig();
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    process.exit(1);
  }

  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);
  const javaRoot = path.join(projectDir, 'src', 'main', 'java', packagePath);

  // ── Locate system.yaml ─────────────────────────────────────────────────
  const systemDir = path.join(projectDir, 'system');
  const systemYamlPath = path.join(systemDir, 'system.yaml');
  if (!(await fs.pathExists(systemYamlPath))) {
    console.error(chalk.red('❌ system/system.yaml not found'));
    console.error(chalk.gray('Create a system.yaml in the system/ directory'));
    process.exit(1);
  }

  const spinner = ora('Parsing system.yaml...').start();

  try {
    // ── 1. Parse system.yaml ─────────────────────────────────────────────
    const parsed = await parseSystemYaml(systemDir);
    const { workflows, activityRegistry, warnings } = parsed;

    if (workflows.length === 0) {
      spinner.warn(chalk.yellow('No workflows found in system.yaml'));
      return;
    }

    spinner.succeed(chalk.green(
      `Found ${workflows.length} workflow(s) with ${activityRegistry.size} registered activities`
    ));

    // Print warnings
    for (const w of warnings) {
      console.log(chalk.yellow(`  ⚠ ${w}`));
    }

    // ── 2. Generate shared activity contracts ────────────────────────────
    const sharedSpinner = ora('Generating shared activity contracts...').start();
    const sharedBasePath = path.join(javaRoot, 'shared');
    const sharedChecksumManager = new ChecksumManager(sharedBasePath);
    await sharedChecksumManager.load();
    const sharedWriteOptions = { force: options.force, checksumManager: sharedChecksumManager };

    const generatedShared = [];
    const processedActivities = new Set();

    // Scan shared/domain/contracts/ once before the loop so that later activities
    // in the same run do not write duplicate nestedTypes for types already written
    // by an earlier module (e.g. CartItemDetail in carts.yaml AND products.yaml).
    const existingSharedTypes = await scanExistingSharedTypes(sharedBasePath);

    // Collect all cross-module activity names from workflows
    for (const wf of workflows) {
      for (const step of wf.steps) {
        // Only generate shared contracts for cross-module activities
        if (!step.isLocal) {
          await processActivity(step.activityName, activityRegistry, packageName, processedActivities, generatedShared, sharedBasePath, sharedWriteOptions, existingSharedTypes);
        }

        // Also handle compensation activities (only cross-module)
        if (step.compensation && step.compensation.module !== wf.hostModule) {
          await processActivity(step.compensation.name, activityRegistry, packageName, processedActivities, generatedShared, sharedBasePath, sharedWriteOptions, existingSharedTypes);
        }
      }
    }

    await sharedChecksumManager.save();
    sharedSpinner.succeed(chalk.green(`${generatedShared.length} shared contract file(s) generated`));

    // ── 3. Generate workflows in host modules ────────────────────────────
    const flowSpinner = ora('Generating workflow implementations...').start();
    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-flow');
    const generatedFlows = [];

    for (const wf of workflows) {
      if (!wf.hostModule) {
        warnings.push(`Workflow '${wf.name}' has no trigger.module — skipping`);
        continue;
      }

      const flowPascal = wf.namePascal.replace(/Workflow$/, '');
      flowSpinner.text = `Generating ${flowPascal}WorkFlow...`;

      const moduleBasePath = path.join(javaRoot, wf.hostModule);
      if (!(await fs.pathExists(moduleBasePath))) {
        warnings.push(`Host module directory '${wf.hostModule}' not found — skipping ${wf.name}`);
        continue;
      }

      const moduleChecksumManager = new ChecksumManager(moduleBasePath);
      await moduleChecksumManager.load();
      const moduleWriteOptions = { force: options.force, checksumManager: moduleChecksumManager };

      // ── Enrich steps with input sources ──────────────────────────────
      enrichStepsWithInputSources(wf.steps);

      // Enrich compensation inputSources
      for (const step of wf.steps) {
        if (step.compensation) {
          enrichCompensationInputSources(step, wf.steps);
        }
      }

      // ── Compute stub activities ──────────────────────────────────────
      const stubActivities = computeStubActivities(wf.steps, activityRegistry, wf.hostModule, existingSharedTypes);

      // ── Compute workflow input fields ────────────────────────────────
      const inputFields = computeWorkflowInputFields(wf.steps);
      const inputImports = resolveFieldImports(inputFields);

      // ── Compute render blocks ────────────────────────────────────────
      const renderBlocks = computeRenderBlocks(wf.steps, wf.parallelGroups);

      const flowContext = {
        packageName,
        moduleName: wf.hostModule,
        modulePascalCase: wf.hostModulePascal,
        moduleCamelCase: wf.hostModule,
        moduleScreamingSnake: wf.hostModuleScreamingSnake,
        flowPascalCase: wf.namePascal.replace(/Workflow$/, ''),
        flowName: wf.name,
        taskQueue: wf.taskQueue,
        isSaga: wf.isSaga,
        steps: wf.steps,
        parallelGroups: wf.parallelGroups,
        targetModules: wf.targetModules,
        hasParallelSteps: wf.hasParallelSteps,
        hasCompensations: wf.hasCompensations,
        hasAsyncSteps: wf.hasAsyncSteps,
        hasOptionalSteps: wf.hasOptionalSteps,
        trigger: wf.trigger,
        // Fase 5 enrichments
        stubActivities,
        inputFields,
        inputImports,
        renderBlocks,
      };

      const usecasesDir = path.join(moduleBasePath, 'application', 'usecases');

      // WorkFlow input record
      if (inputFields.length > 0) {
        await renderAndWrite(
          path.join(templatesDir, 'WorkFlowInput.java.ejs'),
          path.join(usecasesDir, `${flowPascal}Input.java`),
          flowContext,
          moduleWriteOptions
        );
      }

      // WorkFlow interface
      await renderAndWrite(
        path.join(templatesDir, 'WorkFlowInterface.java.ejs'),
        path.join(usecasesDir, `${flowPascal}WorkFlow.java`),
        flowContext,
        moduleWriteOptions
      );

      // WorkFlow implementation
      await renderAndWrite(
        path.join(templatesDir, 'WorkFlowImpl.java.ejs'),
        path.join(usecasesDir, `${flowPascal}WorkFlowImpl.java`),
        flowContext,
        moduleWriteOptions
      );

      // WorkFlow service facade
      await renderAndWrite(
        path.join(templatesDir, 'WorkFlowService.java.ejs'),
        path.join(usecasesDir, `${flowPascal}WorkFlowService.java`),
        flowContext,
        moduleWriteOptions
      );

      // Register workflow in ModuleTemporalWorkerConfig
      const configPath = path.join(
        moduleBasePath, 'infrastructure', 'configurations',
        `${wf.hostModulePascal}TemporalWorkerConfig.java`
      );
      if (await fs.pathExists(configPath)) {
        await registerWorkflowInConfig(
          configPath, packageName, wf.hostModule, flowPascal, wf.hostModulePascal
        );
      }

      // Append module queues to temporal.yaml
      await appendModuleQueues(projectDir, wf.hostModule, wf.hostModuleScreamingSnake);

      await moduleChecksumManager.save();
      generatedFlows.push(wf);
    }

    flowSpinner.succeed(chalk.green(`${generatedFlows.length} workflow(s) generated`));

    // ── 4. Summary ───────────────────────────────────────────────────────
    console.log(chalk.blue('\n📁 Shared contracts:'));
    for (const f of generatedShared) {
      console.log(chalk.gray(`  ${f}`));
    }

    console.log(chalk.blue('\n📁 Workflows:'));
    for (const wf of generatedFlows) {
      const fp = wf.namePascal.replace(/Workflow$/, '');
      console.log(chalk.gray(`  ${wf.hostModule}/application/usecases/${fp}Input.java`));
      console.log(chalk.gray(`  ${wf.hostModule}/application/usecases/${fp}WorkFlow.java`));
      console.log(chalk.gray(`  ${wf.hostModule}/application/usecases/${fp}WorkFlowImpl.java`));
      console.log(chalk.gray(`  ${wf.hostModule}/application/usecases/${fp}WorkFlowService.java`));
    }

    if (warnings.length > 0) {
      console.log(chalk.yellow('\n⚠ Warnings:'));
      for (const w of warnings) {
        console.log(chalk.yellow(`  ${w}`));
      }
    }

    console.log(chalk.green('\n✅ Temporal system generation complete'));

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate temporal system'));
    console.error(chalk.red(error.message));
    if (options.verbose) console.error(error.stack);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Process a single activity for shared contract generation.
 */
async function processActivity(actName, activityRegistry, packageName, processedSet, generatedList, sharedBasePath, writeOptions, existingSharedTypes = new Map()) {
  if (processedSet.has(actName)) return;
  processedSet.add(actName);

  const registered = activityRegistry.get(actName);
  if (!registered) return;

  const actCtx = buildActivityContext(registered.definition, packageName, registered.module, true, null, new Set(), existingSharedTypes);

  const files = await generateSharedContracts(actCtx, sharedBasePath, writeOptions, existingSharedTypes);
  generatedList.push(...files);
}

/**
 * Enrich each step with `inputSources` — where each input field value comes from.
 * Uses system.yaml `rawInputNames` to determine wiring: if a raw input name
 * matches a prior step's `rawOutputNames`, it comes from that step's result.
 * Otherwise it comes from the workflow input.
 */
function enrichStepsWithInputSources(steps) {
  for (const step of steps) {
    const rawNames = step.rawInputNames;
    const sources = [];

    for (let j = 0; j < rawNames.length; j++) {
      const rawName = rawNames[j];

      // Find the most-recent prior step that produced this field (last-wins).
      // When two steps output the same name (e.g. `items` produced by GetCartDetails
      // and then transformed by ValidateAndGetProducts), the later step's version
      // is the one in scope — identical semantics to overwriting a local variable.
      // Note: Array.findLast() requires Node ≥18; [...].reverse().find() is Node 14+ safe.
      const sourceStep = [...steps].reverse().find(
        (s) => s.index < step.index && s.rawOutputNames.includes(rawName)
      );

      if (sourceStep) {
        sources.push({
          source: 'step',
          stepIndex: sourceStep.index,
          varName: sourceStep.activityCamel + 'Result',
          fieldName: rawName,
        });
      } else {
        sources.push({ source: 'input', fieldName: rawName });
      }
    }

    // If no rawInputNames (system.yaml didn't declare input:), fall back to
    // activity formal input fields, all wired from workflow input
    if (rawNames.length === 0 && step.inputFields.length > 0) {
      for (const field of step.inputFields) {
        sources.push({ source: 'input', fieldName: field.name });
      }
    }

    step.inputSources = sources;
  }
}

/**
 * Enrich compensation with inputSources.
 *
 * Compensation undoes what the parent step did, so it receives the same inputs.
 * When the parent step and the compensation activity have the same number of
 * input fields, we reuse the parent step's inputSources directly — this avoids
 * name-based resolution that can match the wrong variable when field names
 * coincide across different types (e.g., `items` in two distinct contexts).
 *
 * Falls back to name-based matching only when the input counts diverge.
 */
function enrichCompensationInputSources(step, allSteps) {
  if (!step.compensation) return;

  const compInputFields = step.compensation.inputFields || [];

  // Primary strategy: reuse parent step's already-resolved inputSources.
  if (step.inputSources && step.inputSources.length === compInputFields.length) {
    step.compensation.inputSources = step.inputSources.map((src) => ({ ...src }));
    return;
  }

  // Fallback: match compensation fields against prior step outputs or workflow input
  const sources = [];

  for (const field of compInputFields) {
    // Same last-wins resolution as enrichStepsWithInputSources.
    const sourceStep = [...allSteps].reverse().find(
      (s) => s.index <= step.index && s.rawOutputNames.includes(field.name)
    );

    if (sourceStep) {
      sources.push({
        source: 'step',
        stepIndex: sourceStep.index,
        varName: sourceStep.activityCamel + 'Result',
        fieldName: field.name,
      });
    } else {
      sources.push({ source: 'input', fieldName: field.name });
    }
  }

  step.compensation.inputSources = sources;
}

/**
 * Compute the list of unique activity stubs needed by the workflow.
 * Includes both main step activities and compensation activities.
 */
function computeStubActivities(steps, activityRegistry, hostModule, existingSharedTypes = new Map()) {
  // Pre-scan: collect all externalType references within this workflow's stubs
  // to detect local nestedTypes that are shared across modules
  const externalRefs = new Set(); // "sourceModule:typeName"
  for (const step of steps) {
    const reg = activityRegistry.get(step.activityName);
    if (reg && reg.definition && Array.isArray(reg.definition.externalTypes)) {
      for (const et of reg.definition.externalTypes) {
        externalRefs.add(`${toCamelCase(et.module)}:${toPascalCase(et.name)}`);
      }
    }
    if (step.compensation) {
      const compReg = activityRegistry.get(step.compensation.name);
      if (compReg && compReg.definition && Array.isArray(compReg.definition.externalTypes)) {
        for (const et of compReg.definition.externalTypes) {
          externalRefs.add(`${toCamelCase(et.module)}:${toPascalCase(et.name)}`);
        }
      }
    }
  }

  // Pre-scan 2: collect simple names contributed by external (non-local) stubs —
  // nestedTypes and externalTypes of external activities live in shared/domain/contracts/{module}/.
  // Used to detect simple-name collisions with local stubs' nestedTypes so the template
  // can emit the correct shared import instead of a local one.
  const externalNestedNames = new Map(); // PascalCase simpleName → camelCase sourceModule
  for (const step of steps) {
    if (!step.isLocal) {
      const reg = activityRegistry.get(step.activityName);
      if (reg && reg.definition) {
        for (const nt of (reg.definition.nestedTypes || [])) {
          const name = toPascalCase(nt.name);
          if (!externalNestedNames.has(name)) externalNestedNames.set(name, step.targetModule);
        }
        for (const et of (reg.definition.externalTypes || [])) {
          const name = toPascalCase(et.name);
          if (!externalNestedNames.has(name)) externalNestedNames.set(name, toCamelCase(et.module));
        }
      }
    }
    if (step.compensation) {
      const compModule = toCamelCase(step.compensation.module || step.targetModule);
      if (compModule !== hostModule) {
        const compReg = activityRegistry.get(step.compensation.name);
        if (compReg && compReg.definition) {
          for (const nt of (compReg.definition.nestedTypes || [])) {
            const name = toPascalCase(nt.name);
            if (!externalNestedNames.has(name)) externalNestedNames.set(name, compModule);
          }
          for (const et of (compReg.definition.externalTypes || [])) {
            const name = toPascalCase(et.name);
            if (!externalNestedNames.has(name)) externalNestedNames.set(name, toCamelCase(et.module));
          }
        }
      }
    }
  }

  const stubs = new Map();

  for (const step of steps) {
    if (!stubs.has(step.activityName)) {
      const registered = activityRegistry.get(step.activityName);
      const rawNestedTypes = registered && registered.definition && Array.isArray(registered.definition.nestedTypes)
        ? registered.definition.nestedTypes.map((nt) => {
            const name = toPascalCase(nt.name);
            // Mark as external if referenced via externalTypes in another stub,
            // OR if an external stub contributes the same simple name (collision → shared wins).
            // existingSharedTypes is the authoritative source: it reflects the actual filesystem
            // path where generateSharedContracts wrote the file (first-writer-wins).
            const isExternallyReferenced = externalRefs.has(`${step.targetModule}:${name}`);
            const collidingExternalModule = externalNestedNames.get(name);
            const actualOwner = existingSharedTypes.get(name);
            const isExternal = isExternallyReferenced || !!collidingExternalModule || !!actualOwner;
            const sourceModule = actualOwner || ((isExternal && collidingExternalModule) ? collidingExternalModule : step.targetModule);
            return { name, sourceModule, isExternal };
          })
        : [];
      const rawExternalTypes = registered && registered.definition && Array.isArray(registered.definition.externalTypes)
        ? registered.definition.externalTypes.map((et) => ({ name: toPascalCase(et.name), sourceModule: toCamelCase(et.module), isExternal: true }))
        : [];
      const nestedTypeImports = [...rawNestedTypes, ...rawExternalTypes];
      stubs.set(step.activityName, {
        activityName: step.activityName,
        activityCamel: step.activityCamel,
        interfaceName: step.activityName + 'Activity',
        stubVarName: step.activityCamel + 'Activity',
        isLocal: step.isLocal,
        queue: step.stepQueue,
        actType: step.actType,
        timeout: parseTimeout(step.timeout),
        targetModule: step.targetModule,
        targetModulePascal: step.targetModulePascal,
        isCompensation: false,
        hasInput: step.hasInput,
        hasOutput: step.hasOutput,
        nestedTypeImports,
      });
    }

    if (step.compensation) {
      const compName = step.compensation.name;
      if (!stubs.has(compName)) {
        const compRegistered = activityRegistry.get(compName);
        const compModule = step.compensation.module;
        const compType = compRegistered ? compRegistered.type : 'light';
        const compQueue = compType === 'heavy'
          ? `${toScreamingSnakeCase(compModule)}_HEAVY_TASK_QUEUE`
          : `${toScreamingSnakeCase(compModule)}_LIGHT_TASK_QUEUE`;
        const compTimeout = compRegistered ? compRegistered.timeout : null;
        const compNestedTypes = compRegistered && compRegistered.definition && Array.isArray(compRegistered.definition.nestedTypes)
          ? compRegistered.definition.nestedTypes.map((nt) => {
              const name = toPascalCase(nt.name);
              const isExternallyReferenced = externalRefs.has(`${compModule}:${name}`);
              const collidingExternalModule = externalNestedNames.get(name);
              const actualOwner = existingSharedTypes.get(name);
              const isExternal = isExternallyReferenced || !!collidingExternalModule || !!actualOwner;
              const sourceModule = actualOwner || ((isExternal && collidingExternalModule) ? collidingExternalModule : compModule);
              return { name, sourceModule, isExternal };
            })
          : [];
        const compExternalTypes = compRegistered && compRegistered.definition && Array.isArray(compRegistered.definition.externalTypes)
          ? compRegistered.definition.externalTypes.map((et) => ({ name: toPascalCase(et.name), sourceModule: toCamelCase(et.module), isExternal: true }))
          : [];
        const compNestedTypeImports = [...compNestedTypes, ...compExternalTypes];

        stubs.set(compName, {
          activityName: compName,
          activityCamel: compName.charAt(0).toLowerCase() + compName.slice(1),
          interfaceName: compName + 'Activity',
          stubVarName: (compName.charAt(0).toLowerCase() + compName.slice(1)) + 'Activity',
          isLocal: compModule === hostModule,
          queue: compQueue,
          actType: compType,
          timeout: parseTimeout(compTimeout),
          targetModule: compModule,
          targetModulePascal: toPascalCase(compModule),
          isCompensation: true,
          hasInput: (step.compensation.inputFields || []).length > 0,
          hasOutput: false,
          nestedTypeImports: compNestedTypeImports,
        });
      }
    }
  }

  return Array.from(stubs.values());
}

/**
 * Compute workflow input fields: all unique field names from step rawInputNames
 * that don't derive from a prior step's rawOutputNames.
 * Types are inferred from the activity's formal input fields (positional).
 */
function computeWorkflowInputFields(steps) {
  const fields = [];
  const seenNames = new Set();
  const priorOutputNames = new Set();

  for (const step of steps) {
    const rawNames = step.rawInputNames.length > 0
      ? step.rawInputNames
      : step.inputFields.map((f) => f.name);

    for (let j = 0; j < rawNames.length; j++) {
      const rawName = rawNames[j];
      if (seenNames.has(rawName)) continue;
      seenNames.add(rawName);

      // Skip fields that come from a prior step's output
      if (priorOutputNames.has(rawName)) continue;

      // Type from activity's formal input field (positional match)
      const formalField = step.inputFields[j];
      const javaType = formalField ? formalField.javaType : 'String';

      fields.push({ name: rawName, javaType });
    }

    // Add this step's outputs to the prior set
    for (const name of step.rawOutputNames) {
      priorOutputNames.add(name);
    }
  }

  return fields;
}

/**
 * Compute render blocks for the WorkFlowImpl template.
 * Groups steps into sequential, parallel, or async blocks.
 */
function computeRenderBlocks(steps, parallelGroups) {
  const blocks = [];
  const inParallelGroup = new Set();

  for (const pg of parallelGroups) {
    for (const s of pg.steps) {
      inParallelGroup.add(s.index);
    }
  }

  for (const step of steps) {
    if (inParallelGroup.has(step.index)) {
      // Only emit a block for the first step in the group
      const group = parallelGroups.find((g) => g.steps[0].index === step.index);
      if (group) {
        blocks.push({ type: 'parallel', steps: group.steps });
      }
    } else if (step.isAsync) {
      blocks.push({ type: 'async', step });
    } else {
      blocks.push({ type: 'sequential', step });
    }
  }

  return blocks;
}

/**
 * Register a workflow class in the module's TemporalWorkerConfig.
 */
async function registerWorkflowInConfig(configPath, packageName, moduleName, flowPascalCase, modulePascalCase) {
  if (!(await fs.pathExists(configPath))) return;

  let content = await fs.readFile(configPath, 'utf-8');

  const implClass = `${flowPascalCase}WorkFlowImpl`;
  const importLine = `import ${packageName}.${moduleName}.application.usecases.${implClass};`;

  // Skip if already registered
  if (content.includes(implClass)) return;

  // Add import
  if (!content.includes(importLine)) {
    const allImports = [...content.matchAll(/^import .+;/gm)];
    if (allImports.length > 0) {
      const lastImport = allImports[allImports.length - 1];
      const insertPos = lastImport.index + lastImport[0].length;
      content = content.slice(0, insertPos) + '\n' + importLine + content.slice(insertPos);
    }
  }

  // Check if there is already an active registerWorkflowImplementationTypes call
  const activeRegisterRegex = /workflowWorker\.registerWorkflowImplementationTypes\(([^)]+)\);/;
  if (activeRegisterRegex.test(content)) {
    content = content.replace(activeRegisterRegex, (match, classes) => {
      const classList = classes
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (!classList.includes(`${implClass}.class`)) {
        classList.push(`${implClass}.class`);
      }
      return `workflowWorker.registerWorkflowImplementationTypes(${classList.join(', ')});`;
    });
  } else {
    // Insert active registration after the comment marker
    content = content.replace(
      /(\/\/ registered by eva g temporal-flow\r?\n)/,
      `$1        workflowWorker.registerWorkflowImplementationTypes(${implClass}.class);\n`
    );
  }

  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Append module queue section to temporal.yaml across all environments.
 */
async function appendModuleQueues(projectDir, moduleName, moduleScreamingSnake) {
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources', 'parameters');
  if (!(await fs.pathExists(resourcesDir))) return;

  const envDirs = await fs.readdir(resourcesDir);
  const queueSection = [
    `    ${moduleName}:`,
    `      flow-queue: ${moduleScreamingSnake}_WORKFLOW_QUEUE`,
    `      light-queue: ${moduleScreamingSnake}_LIGHT_TASK_QUEUE`,
    `      heavy-queue: ${moduleScreamingSnake}_HEAVY_TASK_QUEUE`,
  ].join('\n');

  for (const env of envDirs) {
    const temporalYaml = path.join(resourcesDir, env, 'temporal.yaml');
    if (!(await fs.pathExists(temporalYaml))) continue;

    let content = await fs.readFile(temporalYaml, 'utf-8');

    // Skip if module queues already exist
    if (content.includes(`${moduleName}:`)) continue;

    // Append under temporal.modules:
    if (content.includes('modules:')) {
      content = content.trimEnd() + '\n' + queueSection + '\n';
    } else {
      content = content.trimEnd() + '\n  modules:\n' + queueSection + '\n';
    }

    await fs.writeFile(temporalYaml, content, 'utf-8');
  }
}

module.exports = generateTemporalSystemCommand;
module.exports.computeWorkflowInputFields = computeWorkflowInputFields;
