# Command `export diagram`

## 📋 Description

Converts Mermaid C4 architecture diagrams (`.mmd` files) into Draw.io XML files (`.drawio`) ready to open in [app.diagrams.net](https://app.diagrams.net/).

## 🎯 Purpose

After running `eva evaluate system`, the `system/` folder contains auto-generated Mermaid C4 diagrams. This command turns those text-based diagrams into fully styled, editable Draw.io files — without any manual redrawing.

## 📝 Syntax

```bash
eva export diagram
```

### Parameters

This command takes no additional parameters. It always looks for source files inside the `system/` folder of the current working directory.

## 📂 Input / Output

| Source file (Mermaid) | Generated file (Draw.io) |
|---|---|
| `system/c4-container.mmd` | `system/c4-container.drawio` |
| `system/c4-context.mmd` | `system/c4-context.drawio` |

If a source file does not exist, it is skipped with a warning. The command exits with an error only when **neither** diagram file is found.

## 💡 Example

```bash
# From the project root (must contain a system/ folder)
eva export diagram
```

**Console output:**
```
  ✅ C4 Container → system/c4-container.drawio
     8 nodes, 6 relationships
  ✅ C4 Context → system/c4-context.drawio
     4 nodes, 3 relationships

Open the .drawio files at https://app.diagrams.net/
```

## 🗺️ Supported Mermaid C4 Syntax

The parser understands the following C4 keywords:

### Diagram types

| Keyword | Description |
|---|---|
| `C4Container` | Container-level diagram |
| `C4Context` | Context-level diagram |

### Node types

| Keyword | Example | Draw.io shape |
|---|---|---|
| `Person` | `Person(id, "Name", "Desc")` | Blue C4 person |
| `System` | `System(id, "Name", "Desc")` | Dark-blue rounded box |
| `System_Ext` | `System_Ext(id, "Name", "Desc")` | Grey rounded box |
| `Container` | `Container(id, "Name", "Tech", "Desc")` | Blue rounded box |
| `ContainerDb` | `ContainerDb(id, "Name", "Tech", "Desc")` | Blue data-store shape |
| `ContainerQueue` | `ContainerQueue(id, "Name", "Tech", "Desc")` | Blue cylinder |

### Boundary wrapper

```
System_Boundary(id, "Label") {
  Container(...)
  ContainerDb(...)
}
```

Nodes declared inside a `System_Boundary` block are recognised correctly. The boundary itself is rendered as a dashed-border container in the generated diagram.

### Relationships

```
Rel(fromId, toId, "Label")
Rel(fromId, toId, "Label", "Technology")
```

Relationship arrows are automatically colored by type:

| Condition | Arrow color |
|---|---|
| Source or target is a `Person` | Green |
| Source or target is a `ContainerQueue` (broker) | Orange |
| All other connections | Blue |

## 🎨 Visual Style

All shapes follow the **C4 model color conventions**:

| Element | Fill color |
|---|---|
| Person | `#08427B` (dark blue) |
| Container | `#438DD5` (medium blue) |
| ContainerDb | `#438DD5` (medium blue) |
| ContainerQueue | `#438DD5` (medium blue) |
| System | `#1168BD` (blue) |
| System_Ext | `#999999` (grey) |
| System_Boundary | No fill, dashed border |

## 📐 Auto-layout

The command applies an automatic top-to-bottom layout:

| Row | Content |
|---|---|
| 1 | Persons (centered) |
| 2 | Containers |
| 3 | Databases (`ContainerDb`) |
| 4 | Brokers / queues (`ContainerQueue`) |
| 5 | External systems (`System_Ext`) |

For `C4Context` diagrams (no containers), the layout is:

| Row | Content |
|---|---|
| 1 | Persons |
| 2 | Internal systems (`System`) |
| 3 | External systems (`System_Ext`) |

## ⚠️ Requirements

- Must be run from a directory that contains a `system/` folder.
- Source `.mmd` files must follow the supported C4 syntax above.
- No external diagramming tools or internet access required — conversion runs entirely locally.

## 🔗 Typical Workflow

```bash
# 1. Design your system
#    → edit system/system.yaml

# 2. Evaluate and generate C4 Mermaid diagrams
eva evaluate system

# 3. Convert to Draw.io for sharing / presentations
eva export diagram

# 4. Open in browser
#    → https://app.diagrams.net/ → File → Open from Device
```

## 🔗 Related Commands

- **[evaluate system](./EVALUATE_SYSTEM.md)** — generates the `system/c4-container.mmd` and `system/c4-context.mmd` source files consumed by this command
