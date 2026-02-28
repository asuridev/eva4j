# eva — Quick Reference Cheat Sheet

> Binary: `eva` &nbsp;|&nbsp; Install: `npm install -g eva4j` &nbsp;|&nbsp; [Full docs](docs/commands/INDEX.md)

---

## 🏗️ Project Setup

```bash
eva create <project-name>        # Create Spring Boot project (interactive)
eva add module <module>          # Add hexagonal module to existing project
eva info                         # Show project config and module list
eva detach <module>              # Extract module to standalone microservice
```

---

## ⚡ Code Generation

### Domain Model

```bash
eva g entities <module>          # Generate full CRUD from domain.yaml
```

### Use Cases (CQRS)

```bash
eva g usecase <module>           # Create command or query (interactive)
```

### REST API

```bash
eva g resource <module>          # Generate REST controller + 5 CRUD use cases
eva g record <module>            # Create immutable Java Record (DTO / value object)
```

---

## 🔌 Integration

### HTTP Clients

```bash
eva g http-exchange <module>     # Spring OpenFeign HTTP client (interactive)
```

### Kafka

```bash
eva add kafka-client             # Install Kafka SDK + base configuration
eva g kafka-event <module>       # Kafka event publisher (interactive)
eva g kafka-listener <module>    # Kafka event consumer(s) — select topics
```

### Temporal Workflows

```bash
eva add temporal-client          # Install Temporal SDK + 3-queue worker setup
eva g temporal-flow <module>     # Workflow interface + Saga impl + service facade
eva g temporal-activity <module> # Activity interface + impl (Light or Heavy)
```

---

## 🔤 Aliases

All `generate` commands can be shortened to `g`:

| Full form | Short alias |
|-----------|-------------|
| `eva generate entities` | `eva g entities` |
| `eva generate usecase` | `eva g usecase` |
| `eva generate resource` | `eva g resource` |
| `eva generate record` | `eva g record` |
| `eva generate http-exchange` | `eva g http-exchange` |
| `eva generate kafka-event` | `eva g kafka-event` |
| `eva generate kafka-listener` | `eva g kafka-listener` |
| `eva generate temporal-flow` | `eva g temporal-flow` |
| `eva generate temporal-activity` | `eva g temporal-activity` |

---

## 📋 Typical Project Workflow

```bash
# 1. Bootstrap
eva create my-app && cd my-app

# 2. Add modules
eva add module order
eva add module notification

# 3. Generate domain model (edit domain.yaml first)
eva g entities order

# 4. Add custom use cases
eva g usecase order

# 5. Expose via REST
eva g resource order

# 6. Add async events
eva add kafka-client
eva g kafka-event order order-placed
eva g kafka-listener notification

# 7. Add workflow orchestration
eva add temporal-client
eva g temporal-flow order          # e.g., process-order
eva g temporal-activity order      # e.g., validate-stock (Light)
eva g temporal-activity order      # e.g., charge-payment (Heavy)

# 8. Extract to microservice when ready
eva detach order
```

---

## 🧩 Temporal Queue Model

| Queue | Purpose | ActivityOptions var |
|-------|---------|---------------------|
| `FLOW_QUEUE` | Workflow orchestration | — |
| `LIGHT_TASK_QUEUE` | Fast activities < 30 s | `lightActivityOptions` |
| `HEAVY_TASK_QUEUE` | Long-running ≤ 2 min | `heavyActivityOptions` |

Activities are registered automatically via Spring DI (`LightActivity` / `HeavyActivity` marker interfaces). No manual `TemporalConfig.java` patching needed.

---

## 📁 Project Config File

**`.eva4j.json`** is auto-created and managed. Commit it to git.

```bash
eva info    # Read current config
```

---

## 📚 Full Documentation

| Resource | Link |
|----------|------|
| All commands | [docs/commands/INDEX.md](docs/commands/INDEX.md) |
| YAML guide | [DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md) |
| AI agent guide | [AGENTS.md](AGENTS.md) |
| YAML examples | [examples/](examples/) |
| Temporal flow | [docs/commands/GENERATE_TEMPORAL_FLOW.md](docs/commands/GENERATE_TEMPORAL_FLOW.md) |
| Temporal activity | [docs/commands/GENERATE_TEMPORAL_ACTIVITY.md](docs/commands/GENERATE_TEMPORAL_ACTIVITY.md) |
