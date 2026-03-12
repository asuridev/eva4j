'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const http = require('http');
const ejs = require('ejs');
const ora = require('ora');

const { validateSystem } = require('../utils/system-validator');

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

// ── Data extraction ──────────────────────────────────────────────────────────

function extractReportData(systemConfig, validation) {
  const modulesConfig = systemConfig.modules || [];
  const asyncEvents = (systemConfig.integrations || {}).async || [];
  const syncIntegrations = (systemConfig.integrations || {}).sync || [];

  // Build modules map with color + icon
  const modulesMap = {};
  for (let i = 0; i < modulesConfig.length; i++) {
    const mod = modulesConfig[i];
    modulesMap[mod.name] = {
      id: mod.name,
      label: toPascalCase(mod.name),
      icon: assignIcon(mod.name),
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
      desc: mod.description || mod.name,
    };
  }

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

  return {
    systemName: (systemConfig.system || {}).name || 'eva4j system',
    modules: Object.values(modulesMap),
    events,
    syncIntegrations: syncList,
    endpoints,
    flows,
    validation,
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

  // ── 2. Run validation ───────────────────────────────────────────────────
  const validation = validateSystem(systemConfig);

  // ── 3. Extract report data ──────────────────────────────────────────────
  const reportData = extractReportData(systemConfig, validation);

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

  // ── 7. Start HTTP server ─────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
  });

  server.listen(port, () => {
    console.log(chalk.gray(`Report written to: ${outputPath}`));
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

function toPascalCase(str) {
  return str
    .replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (c) => c.toUpperCase());
}

module.exports = evaluateSystemCommand;
