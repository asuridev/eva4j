'use strict';

/**
 * Validates a parsed system.yaml object against 5 architectural checks.
 *
 * @param {object} systemConfig - Parsed system.yaml content
 * @returns {{ errors: string[], warnings: string[], ok: string[], score: number }}
 */
function validateSystem(systemConfig) {
  const errors = [];
  const warnings = [];
  const ok = [];

  const modules = systemConfig.modules || [];
  const moduleNames = new Set(modules.map((m) => m.name));
  const integrations = systemConfig.integrations || {};
  const asyncEvents = integrations.async || [];
  const syncIntegrations = integrations.sync || [];

  // Build a quick lookup: module name → exposes array of "METHOD /path" strings
  const moduleExposes = {};
  for (const mod of modules) {
    moduleExposes[mod.name] = (mod.exposes || []).map(
      (ep) => `${ep.method} ${ep.path}`
    );
  }

  // ── Check 1: Referential Integrity ────────────────────────────────────────

  // 1a. Event producers
  for (const ev of asyncEvents) {
    if (!moduleNames.has(ev.producer)) {
      errors.push(
        `Integridad referencial: el productor '${ev.producer}' del evento '${ev.event}' no está declarado en modules[]`
      );
    } else {
      ok.push(`Productor '${ev.producer}' del evento '${ev.event}' existe ✓`);
    }
  }

  // 1b. Event consumers
  for (const ev of asyncEvents) {
    const consumers = ev.consumers || [];
    for (const c of consumers) {
      const moduleName = typeof c === 'string' ? c : c.module;
      if (!moduleNames.has(moduleName)) {
        errors.push(
          `Integridad referencial: el consumidor '${moduleName}' del evento '${ev.event}' no está declarado en modules[]`
        );
      }
    }
  }
  if (asyncEvents.every((ev) => (ev.consumers || []).every((c) => moduleNames.has(typeof c === 'string' ? c : c.module)))) {
    ok.push('Todos los consumidores de eventos están declarados como módulos ✓');
  }

  // 1c. Sync integration caller/callee existence
  for (const sync of syncIntegrations) {
    if (!moduleNames.has(sync.caller)) {
      errors.push(
        `Integridad referencial: el caller '${sync.caller}' de la integración síncrona no está declarado en modules[]`
      );
    }
    if (!moduleNames.has(sync.calls)) {
      errors.push(
        `Integridad referencial: el callee '${sync.calls}' de la integración síncrona (caller: ${sync.caller}) no está declarado en modules[]`
      );
    }
  }

  // 1d. Sync endpoints exist in target module's exposes
  let allSyncEndpointsFound = true;
  for (const sync of syncIntegrations) {
    if (!moduleNames.has(sync.calls)) continue; // already caught above
    const targetExposes = moduleExposes[sync.calls] || [];
    for (const endpoint of sync.using || []) {
      const normalized = endpoint.trim().toUpperCase().replace(/\/+$/, '');
      const found = targetExposes.some((ep) => {
        const normalizedEp = ep.trim().toUpperCase().replace(/\/+$/, '');
        return normalizedEp === normalized || endpointMatches(ep, endpoint);
      });
      if (!found) {
        errors.push(
          `Integridad referencial: el endpoint '${endpoint}' usado por '${sync.caller}' no está declarado en el exposes[] de '${sync.calls}'`
        );
        allSyncEndpointsFound = false;
      }
    }
  }
  if (allSyncEndpointsFound && syncIntegrations.length > 0) {
    ok.push('Todos los endpoints usados en integraciones síncronas están declarados en los módulos destino ✓');
  }

  // ── Check 2: Cycle Detection (sync deps) ─────────────────────────────────

  // Build directed graph: A → B when caller=A, calls=B
  const syncGraph = {};
  for (const sync of syncIntegrations) {
    if (!syncGraph[sync.caller]) syncGraph[sync.caller] = [];
    syncGraph[sync.caller].push(sync.calls);
  }

  // Detect strict bidirectional sync coupling (A→B and B→A)
  const biDirChecked = new Set();
  let biDirFound = false;
  for (const sync of syncIntegrations) {
    const key = [sync.caller, sync.calls].sort().join('↔');
    if (biDirChecked.has(key)) continue;
    biDirChecked.add(key);
    const reverse = syncIntegrations.find(
      (s) => s.caller === sync.calls && s.calls === sync.caller
    );
    if (reverse) {
      errors.push(
        `Acoplamiento circular síncrono: '${sync.caller}' y '${sync.calls}' se llaman mutuamente de forma síncrona. Esto puede causar deadlocks.`
      );
      biDirFound = true;
    }
  }

  // DFS for longer cycles
  function detectCycle(startNode) {
    const visited = new Set();
    function dfs(node, path) {
      if (path.includes(node)) return path.concat(node);
      if (visited.has(node)) return null;
      visited.add(node);
      for (const neighbor of syncGraph[node] || []) {
        const result = dfs(neighbor, path.concat(node));
        if (result) return result;
      }
      return null;
    }
    return dfs(startNode, []);
  }

  const cycleChecked = new Set();
  let cycleFound = false;
  for (const node of Object.keys(syncGraph)) {
    if (cycleChecked.has(node)) continue;
    const cycle = detectCycle(node);
    if (cycle && cycle.length > 2) {
      const cycleStr = cycle.join(' → ');
      errors.push(`Ciclo síncrono detectado: ${cycleStr}`);
      cycle.forEach((n) => cycleChecked.add(n));
      cycleFound = true;
    }
  }

  if (!biDirFound && !cycleFound) {
    ok.push('No se detectaron ciclos ni acoplamiento síncrono bidireccional ✓');
  }

  // ── Check 3: Role Analysis ────────────────────────────────────────────────

  for (const mod of modules) {
    const hasExposes = (mod.exposes || []).length > 0;
    const producesEvents = asyncEvents.some((e) => e.producer === mod.name);
    const consumesEvents = asyncEvents.some((e) =>
      (e.consumers || []).some((c) => (typeof c === 'string' ? c : c.module) === mod.name)
    );
    const makesSyncCalls = syncIntegrations.some((s) => s.caller === mod.name);
    const receivesSyncCalls = syncIntegrations.some((s) => s.calls === mod.name);

    const hasAnyIntegration = producesEvents || consumesEvents || makesSyncCalls || receivesSyncCalls;

    if (!hasExposes && !hasAnyIntegration) {
      warnings.push(
        `Módulo aislado: '${mod.name}' no tiene endpoints expuestos ni integraciones declaradas`
      );
    } else if (!hasExposes) {
      warnings.push(
        `'${mod.name}' no tiene endpoints expuestos (exposes[] vacío o ausente)`
      );
    } else if (!hasAnyIntegration) {
      ok.push(`'${mod.name}' es un módulo autónomo sin dependencias de integración`);
    }

    // Check: module that only consumes — expected, no warning
    if (!producesEvents && consumesEvents && !makesSyncCalls) {
      ok.push(`'${mod.name}' es consumidor puro de eventos (correcto: no produce eventos propios)`);
    }
  }

  // ── Check 4: Behavior Gaps ─────────────────────────────────────────────────

  const schedulerVerbs = ['expire', 'clean', 'close', 'archive', 'timeout', 'process', 'purge', 'flush'];
  const mutationMethods = new Set(['PUT', 'PATCH', 'DELETE', 'POST']);

  for (const mod of modules) {
    for (const ep of mod.exposes || []) {
      const useCaseLower = (ep.useCase || '').toLowerCase();
      const method = (ep.method || '').toUpperCase();

      if (!mutationMethods.has(method)) continue;

      const matchedVerb = schedulerVerbs.find((v) => useCaseLower.startsWith(v) || useCaseLower.includes(v));
      if (!matchedVerb) continue;

      // Check: is this endpoint reachable via an async event
      const triggeredByEvent = asyncEvents.some((ev) =>
        (ev.consumers || []).some((c) => {
          const consumer = typeof c === 'string' ? c : c.module;
          if (consumer !== mod.name) return false;
          // The event name often matches the use case verb
          const eventLower = ev.event.toLowerCase();
          return schedulerVerbs.some((v) => eventLower.includes(v));
        })
      );

      // Check: is this endpoint called by a sync integration
      const triggeredBySync = syncIntegrations.some((s) => s.calls === mod.name && (s.using || []).some((u) => u.includes(ep.path)));

      if (!triggeredByEvent && !triggeredBySync) {
        warnings.push(
          `Gap de comportamiento: '${ep.useCase}' (${ep.method} ${ep.path}) en '${mod.name}' no tiene ningún evento ni llamada síncrona que lo active. Puede necesitar un scheduler o job periódico.`
        );
      }
    }
  }

  // Check: modules with no exposes at all (already partially covered above, but surface separately)
  for (const mod of modules) {
    if (!mod.exposes || mod.exposes.length === 0) {
      ok.push(`'${mod.name}' no expone endpoints REST directamente (módulo de integración)`);
    }
  }

  // ── Check 5: Coupling Patterns ────────────────────────────────────────────

  for (const sync of syncIntegrations) {
    const caller = sync.caller;
    const callee = sync.calls;

    // Find reverse async: callee publishes event that caller consumes
    const reverseAsyncEvents = asyncEvents.filter((ev) => {
      if (ev.producer !== callee) return false;
      return (ev.consumers || []).some((c) => (typeof c === 'string' ? c : c.module) === caller);
    });

    if (reverseAsyncEvents.length > 0) {
      const eventNames = reverseAsyncEvents.map((e) => e.event).join(', ');
      warnings.push(
        `Acoplamiento asimétrico: '${caller}' llama síncronamente a '${callee}', mientras '${callee}' responde vía eventos asíncronos (${eventNames}). Considerar pasar los datos necesarios directamente en el evento para eliminar la llamada síncrona.`
      );
    }
  }

  // Detect dual trigger: endpoint appears in both sync.using and as event-triggered consumer
  for (const mod of modules) {
    for (const ep of mod.exposes || []) {
      const endpointStr = `${ep.method} ${ep.path}`;
      const inSync = syncIntegrations.some(
        (s) => s.calls === mod.name && (s.using || []).some((u) => endpointMatches(endpointStr, u) || endpointMatches(u, endpointStr))
      );
      const inEvents = asyncEvents.some(
        (ev) =>
          (ev.consumers || []).some((c) => (typeof c === 'string' ? c : c.module) === mod.name) &&
          asyncEvents.some(() => false) // placeholder; real dual-trigger needs business knowledge
      );
      // Flag endpoints used in sync AND the module also consumes events (approximate heuristic)
      if (inSync) {
        const modConsumesEvents = asyncEvents.some((ev) =>
          (ev.consumers || []).some((c) => (typeof c === 'string' ? c : c.module) === mod.name)
        );
        if (modConsumesEvents) {
          ok.push(
            `'${mod.name}' tiene endpoints accesibles tanto síncronamente como vía eventos (diseño dual — intencional)`
          );
          break; // one ok per module is enough
        }
      }
      void inEvents; // suppress unused warning
    }
  }

  // Highlight producer-only modules (no event consumption, no sync calls received) — healthy pattern
  for (const mod of modules) {
    const onlyProduces =
      asyncEvents.some((e) => e.producer === mod.name) &&
      !asyncEvents.some((e) =>
        (e.consumers || []).some((c) => (typeof c === 'string' ? c : c.module) === mod.name)
      ) &&
      !syncIntegrations.some((s) => s.calls === mod.name);

    if (onlyProduces) {
      ok.push(`'${mod.name}' es productor puro de eventos sin dependencias entrantes (bajo acoplamiento) ✓`);
    }
  }

  // ── Score ────────────────────────────────────────────────────────────────

  const total = ok.length + errors.length + warnings.length * 0.5;
  const score = total > 0 ? Math.round((ok.length / total) * 100) : 100;

  return { errors, warnings, ok, score };
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
