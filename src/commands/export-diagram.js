'use strict';

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// ─── Draw.io C4 Style Strings ──────────────────────────────────────────────

const STYLES = {
  person: [
    'shape=mxgraph.c4.person2',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'align=center',
    'strokeColor=#3C7FC0',
    'fillColor=#08427B',
    'metaEdit=1',
    'points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]]',
    'resizable=0',
  ].join(';'),

  container: [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'fillColor=#438DD5',
    'strokeColor=#3C7FC0',
    'metaEdit=1',
    'points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]]',
  ].join(';'),

  containerDb: [
    'shape=mxgraph.c4.dataStoreContainer2',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'fillColor=#438DD5',
    'strokeColor=#3C7FC0',
    'metaEdit=1',
    'points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]]',
  ].join(';'),

  containerQueue: [
    'shape=cylinder3',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'fillColor=#438DD5',
    'strokeColor=#3C7FC0',
    'size=15',
    'metaEdit=1',
    'boundedLbl=1',
    'points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]]',
  ].join(';'),

  systemExt: [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'fillColor=#999999',
    'strokeColor=#8A8A8A',
    'metaEdit=1',
    'points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]]',
  ].join(';'),

  system: [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'fontSize=11',
    'fontColor=#ffffff',
    'fillColor=#1168BD',
    'strokeColor=#0B4884',
    'metaEdit=1',
    'points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]]',
  ].join(';'),

  boundary: [
    'rounded=1',
    'fontSize=11',
    'whiteSpace=wrap',
    'html=1',
    'dashed=1',
    'arcSize=20',
    'fillColor=none',
    'strokeColor=#666666',
    'fontColor=#333333',
    'container=1',
    'pointerEvents=0',
    'collapsible=0',
    'recursiveResize=0',
  ].join(';'),

  relSync: [
    'endArrow=blockThin',
    'html=1',
    'fontSize=10',
    'fontColor=#404040',
    'strokeWidth=2',
    'endFill=1',
    'strokeColor=#2171B5',
    'elbow=vertical',
    'metaEdit=1',
    'endSize=14',
  ].join(';'),

  relAsync: [
    'endArrow=blockThin',
    'html=1',
    'fontSize=10',
    'fontColor=#404040',
    'strokeWidth=2',
    'endFill=1',
    'strokeColor=#E6550D',
    'elbow=vertical',
    'metaEdit=1',
    'endSize=14',
  ].join(';'),

  relPerson: [
    'endArrow=blockThin',
    'html=1',
    'fontSize=10',
    'fontColor=#404040',
    'strokeWidth=2',
    'endFill=1',
    'strokeColor=#2CA02C',
    'elbow=vertical',
    'metaEdit=1',
    'endSize=14',
  ].join(';'),
};

// ─── XML Helpers ────────────────────────────────────────────────────────────

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlLabel(lines) {
  return lines.map((l) => `&lt;div&gt;${l}&lt;/div&gt;`).join('');
}

function label(name, typeTag, description) {
  const parts = [`&lt;b&gt;${esc(name)}&lt;/b&gt;`];
  if (typeTag) parts.push(`&lt;div&gt;${esc(typeTag)}&lt;/div&gt;`);
  parts.push('&lt;div&gt;&lt;br&gt;&lt;/div&gt;');
  if (description) parts.push(`&lt;div&gt;${esc(description)}&lt;/div&gt;`);
  return parts.join('');
}

function relLabelXml(text, technology) {
  let out = `&lt;b&gt;${esc(text)}&lt;/b&gt;`;
  if (technology) out += `&lt;div&gt;[${esc(technology)}]&lt;/div&gt;`;
  return out;
}

// ─── Mermaid C4 Parser ──────────────────────────────────────────────────────

function parseMermaidC4(content) {
  const lines = content.split('\n').map((l) => l.trim());
  const nodes = [];
  const rels = [];
  let title = '';
  let boundaryId = null;
  let boundaryLabel = '';
  let insideBoundary = false;

  for (const line of lines) {
    if (!line || /^(C4Container|C4Context)$/.test(line)) continue;
    if (line === '}') { insideBoundary = false; continue; }

    // title
    let m = line.match(/^title\s+(.+)$/);
    if (m) { title = m[1]; continue; }

    // System_Boundary(id, "label") {
    m = line.match(/^System_Boundary\(\s*(\w+)\s*,\s*"([^"]+)"\s*\)\s*\{?\s*$/);
    if (m) { boundaryId = m[1]; boundaryLabel = m[2]; insideBoundary = true; continue; }

    // Person(id, "name", "desc")
    m = line.match(/^Person\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'person', id: m[1], name: m[2], description: m[3], parent: insideBoundary ? boundaryId : null }); continue; }

    // System(id, "name", "desc")
    m = line.match(/^System\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'system', id: m[1], name: m[2], description: m[3], parent: insideBoundary ? boundaryId : null }); continue; }

    // Container(id, "name", "tech", "desc")
    m = line.match(/^Container\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'container', id: m[1], name: m[2], technology: m[3], description: m[4], parent: insideBoundary ? boundaryId : null }); continue; }

    // ContainerDb(id, "name", "tech", "desc")
    m = line.match(/^ContainerDb\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'containerDb', id: m[1], name: m[2], technology: m[3], description: m[4], parent: insideBoundary ? boundaryId : null }); continue; }

    // ContainerQueue(id, "name", "tech", "desc")
    m = line.match(/^ContainerQueue\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'containerQueue', id: m[1], name: m[2], technology: m[3], description: m[4], parent: insideBoundary ? boundaryId : null }); continue; }

    // System_Ext(id, "name", "desc")
    m = line.match(/^System_Ext\(\s*(\w+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
    if (m) { nodes.push({ type: 'systemExt', id: m[1], name: m[2], description: m[3], parent: insideBoundary ? boundaryId : null }); continue; }

    // Rel(from, to, "label", "tech") — tech is optional
    m = line.match(/^Rel\(\s*(\w+)\s*,\s*(\w+)\s*,\s*"([^"]+)"\s*(?:,\s*"([^"]*)")?\s*\)$/);
    if (m) { rels.push({ from: m[1], to: m[2], label: m[3], technology: m[4] || '' }); continue; }
  }

  return { title, boundaryId, boundaryLabel, nodes, rels };
}

// ─── Layout Engine ──────────────────────────────────────────────────────────
//
//  Top-to-bottom:
//    Row 1  — Persons (centered)
//    Row 2  — System Boundary { containers in grid }
//    Row 2b — DB (left) + Broker (right) at bottom of boundary
//    Row 3  — External systems (centered)
//
//  C4Context (no containers):
//    Row 1 — Persons
//    Row 2 — System
//    Row 3 — Externals
//

const DIMS = {
  person:         { w: 170, h: 180 },
  container:      { w: 240, h: 120 },
  containerDb:    { w: 240, h: 120 },
  containerQueue: { w: 240, h: 120 },
  systemExt:      { w: 240, h: 120 },
  system:         { w: 240, h: 120 },
};

const GAP_X = 40;
const GAP_Y = 60;
const BOUNDARY_PAD = 40;

function computeLayout(parsed) {
  const positions = {};

  const persons    = parsed.nodes.filter((n) => n.type === 'person');
  const containers = parsed.nodes.filter((n) => n.type === 'container');
  const dbs        = parsed.nodes.filter((n) => n.type === 'containerDb');
  const queues     = parsed.nodes.filter((n) => n.type === 'containerQueue');
  const externals  = parsed.nodes.filter((n) => n.type === 'systemExt');
  const systems    = parsed.nodes.filter((n) => n.type === 'system');

  const COLS = containers.length || 1;
  const containerRows = 1;
  const infraItems = [...dbs, ...queues];
  const innerW = COLS * DIMS.container.w + (COLS - 1) * GAP_X;
  const boundaryW = innerW + 2 * BOUNDARY_PAD;

  let cursorY = 0;

  // ── Row 1: Persons ──
  if (persons.length > 0) {
    const totalW = persons.length * DIMS.person.w + (persons.length - 1) * GAP_X;
    const startX = (boundaryW - totalW) / 2;
    persons.forEach((p, i) => {
      positions[p.id] = {
        x: Math.max(0, startX) + i * (DIMS.person.w + GAP_X),
        y: cursorY,
        w: DIMS.person.w,
        h: DIMS.person.h,
      };
    });
    cursorY += DIMS.person.h + GAP_Y;
  }

  // ── C4Context: System node (no containers) ──
  if (systems.length > 0 && containers.length === 0) {
    const totalW = systems.length * DIMS.system.w + (systems.length - 1) * GAP_X;
    const refW = Math.max(boundaryW, 500);
    const startX = (refW - totalW) / 2;
    systems.forEach((s, i) => {
      positions[s.id] = {
        x: Math.max(0, startX) + i * (DIMS.system.w + GAP_X),
        y: cursorY,
        w: DIMS.system.w,
        h: DIMS.system.h,
      };
    });
    cursorY += DIMS.system.h + GAP_Y;
  }

  // ── Row 2: Containers (no boundary) ──
  if (containers.length > 0) {
    containers.forEach((c, i) => {
      positions[c.id] = {
        x: i * (DIMS.container.w + GAP_X),
        y: cursorY,
        w: DIMS.container.w,
        h: DIMS.container.h,
      };
    });
    cursorY += DIMS.container.h + GAP_Y;
  }

  // ── Row 3: DB (centered) ──
  if (dbs.length > 0) {
    const dbTotalW = dbs.length * DIMS.containerDb.w + (dbs.length - 1) * GAP_X;
    const dbStartX = (innerW - dbTotalW) / 2;
    dbs.forEach((d, i) => {
      positions[d.id] = {
        x: Math.max(0, dbStartX) + i * (DIMS.containerDb.w + GAP_X),
        y: cursorY,
        w: DIMS.containerDb.w,
        h: DIMS.containerDb.h,
      };
    });
    cursorY += DIMS.containerDb.h + GAP_Y;
  }

  // ── Row 4: Broker (centered) ──
  if (queues.length > 0) {
    const qTotalW = queues.length * DIMS.containerQueue.w + (queues.length - 1) * GAP_X;
    const qStartX = (innerW - qTotalW) / 2;
    queues.forEach((q, i) => {
      positions[q.id] = {
        x: Math.max(0, qStartX) + i * (DIMS.containerQueue.w + GAP_X),
        y: cursorY,
        w: DIMS.containerQueue.w,
        h: DIMS.containerQueue.h,
      };
    });
    cursorY += DIMS.containerQueue.h + GAP_Y;
  }

  // ── Row 5: External Systems ──
  if (externals.length > 0) {
    const totalW = externals.length * DIMS.systemExt.w + (externals.length - 1) * GAP_X;
    const startX = (innerW - totalW) / 2;
    externals.forEach((e, i) => {
      positions[e.id] = {
        x: Math.max(0, startX) + i * (DIMS.systemExt.w + GAP_X),
        y: cursorY,
        w: DIMS.systemExt.w,
        h: DIMS.systemExt.h,
      };
    });
  }

  return { positions };
}

// ─── Draw.io XML Generator ─────────────────────────────────────────────────

function generateDrawioXml(parsed) {
  const { positions } = computeLayout(parsed);
  const cells = [];
  let relCounter = 0;

  cells.push('    <mxCell id="0"/>');
  cells.push('    <mxCell id="1" parent="0"/>');

  // Nodes (all in root layer, no boundary grouping)
  for (const node of parsed.nodes) {
    const pos = positions[node.id];
    if (!pos) continue;

    let style, lbl;
    const parent = '1';

    switch (node.type) {
      case 'person':
        style = STYLES.person;
        lbl = label(node.name, '[Person]', node.description);
        break;
      case 'container':
        style = STYLES.container;
        lbl = label(node.name, `[Container: ${node.technology}]`, node.description);
        break;
      case 'containerDb':
        style = STYLES.containerDb;
        lbl = label(node.name, `[Container: ${node.technology}]`, node.description);
        break;
      case 'containerQueue':
        style = STYLES.containerQueue;
        lbl = label(node.name, `[Container: ${node.technology}]`, node.description);
        break;
      case 'systemExt':
        style = STYLES.systemExt;
        lbl = label(node.name, '[External System]', node.description);
        break;
      case 'system':
        style = STYLES.system;
        lbl = label(node.name, '[Software System]', node.description);
        break;
      default:
        continue;
    }

    cells.push(
      `    <mxCell id="${node.id}" value="${lbl}" style="${style}" vertex="1" parent="${parent}">`,
      `      <mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" as="geometry"/>`,
      '    </mxCell>'
    );
  }

  // Classify nodes for relationship coloring
  const dbNodeIds = new Set(parsed.nodes.filter((n) => n.type === 'containerDb').map((n) => n.id));
  const brokerNodeIds = new Set(parsed.nodes.filter((n) => n.type === 'containerQueue').map((n) => n.id));
  const personNodeIds = new Set(parsed.nodes.filter((n) => n.type === 'person').map((n) => n.id));

  // Filter out individual DB connections, replace with a single one
  const filteredRels = parsed.rels.filter((r) => !dbNodeIds.has(r.from) && !dbNodeIds.has(r.to));

  const containerNodes = parsed.nodes.filter((n) => n.type === 'container');
  if (dbNodeIds.size > 0 && containerNodes.length > 0) {
    const midContainer = containerNodes[Math.floor(containerNodes.length / 2)];
    filteredRels.push({
      from: midContainer.id,
      to: [...dbNodeIds][0],
      label: 'All modules: Reads/Writes',
      technology: 'JDBC',
    });
  }

  // Relationships — green for persons, orange for async, blue for sync
  for (const rel of filteredRels) {
    const id = `rel_${++relCounter}`;
    const lbl = relLabelXml(rel.label, rel.technology);
    const isPerson = personNodeIds.has(rel.from) || personNodeIds.has(rel.to);
    const isAsync = brokerNodeIds.has(rel.from) || brokerNodeIds.has(rel.to);
    const style = isPerson ? STYLES.relPerson : isAsync ? STYLES.relAsync : STYLES.relSync;
    cells.push(
      `    <mxCell id="${id}" value="${lbl}" style="${style}" edge="1" source="${rel.from}" target="${rel.to}" parent="1">`,
      '      <mxGeometry as="geometry"/>',
      '    </mxCell>'
    );
  }

  const diagramName = esc(parsed.title || 'C4 Diagram');
  return [
    '<mxfile host="app.diagrams.net">',
    `  <diagram name="${diagramName}" id="c4-diagram">`,
    '    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">',
    '      <root>',
    ...cells,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
}

// ─── Command Handler ────────────────────────────────────────────────────────

async function exportDiagramCommand(type, options) {
  if (type !== 'diagram') {
    console.error(chalk.red(`❌ Unknown export type: ${type}`));
    console.log(chalk.gray('Usage: eva export diagram'));
    process.exit(1);
  }

  const systemDir = path.join(process.cwd(), 'system');

  const diagrams = [
    { src: 'c4-container.mmd', out: 'c4-container.drawio', name: 'C4 Container' },
    { src: 'c4-context.mmd',   out: 'c4-context.drawio',   name: 'C4 Context' },
  ];

  let generated = 0;

  for (const diagram of diagrams) {
    const srcPath = path.join(systemDir, diagram.src);

    if (!await fs.pathExists(srcPath)) {
      console.log(chalk.yellow(`  ⚠ ${diagram.src} not found — skipping`));
      continue;
    }

    const content = await fs.readFile(srcPath, 'utf8');
    const parsed = parseMermaidC4(content);

    if (parsed.nodes.length === 0) {
      console.log(chalk.yellow(`  ⚠ ${diagram.src} has no parseable C4 nodes — skipping`));
      continue;
    }

    const xml = generateDrawioXml(parsed);
    const outPath = path.join(systemDir, diagram.out);
    await fs.writeFile(outPath, xml, 'utf8');

    console.log(chalk.green(`  ✅ ${diagram.name} → system/${diagram.out}`));
    const edgeCount = (xml.match(/edge="1"/g) || []).length;
    console.log(chalk.gray(`     ${parsed.nodes.length} nodes, ${edgeCount} relationships`));
    generated++;
  }

  if (generated === 0) {
    console.error(chalk.red('❌ No C4 diagram files found in system/'));
    console.log(chalk.gray('Expected: system/c4-container.mmd and/or system/c4-context.mmd'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.blue(`Open the .drawio files at ${chalk.bold('https://app.diagrams.net/')}`));
}

module.exports = exportDiagramCommand;
