# Command `generate usecase` (alias: `g usecase`)

## Description

Generates CQRS use cases (Commands or Queries) with their handlers, following the Command Query Responsibility Segregation pattern.

## Purpose

Create individual use cases for specific business operations, maintaining clear separation between write operations (Commands) and read operations (Queries).

## Syntax

```bash
eva generate usecase <module> [name]
eva g usecase <module> [name]    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Module where the use case will be created (e.g., `user`, `order`) |
| `name` | No | Use case name in kebab-case or PascalCase — prompted if omitted |

> **Interactive prompts:**
> 1. **Use case name** — if not provided as argument (e.g., `create-user`, `find-user-by-id`)
> 2. **Type** — `Command` (write) or `Query` (read)

## Examples

### Example 1: Create command

```bash
eva g usecase user create-user
# Prompted for type → Command
```

Generates:
- `application/commands/CreateUserCommand.java`
- `application/usecases/CreateUserCommandHandler.java`

### Example 2: Find query

```bash
eva g usecase user find-user-by-id
# Prompted for type → Query
```

Generates:
- `application/queries/FindUserByIdQuery.java`
- `application/usecases/FindUserByIdQueryHandler.java`
- `application/dtos/FindUserByIdResponseDto.java`

### Example 3: Module-specific commands

```bash
eva g usecase order cancel-order         # Command
eva g usecase product update-stock       # Command
eva g usecase order find-orders-by-customer  # Query
```

## Generated Code Structure

### Command

**CreateUserCommand.java** (`application/commands/`):
```java
package com.example.project.user.application.commands;

public record CreateUserCommand(
    // TODO: add command fields
) {
}
```

**CreateUserCommandHandler.java** (`application/usecases/`):
```java
package com.example.project.user.application.usecases;

import com.example.project.user.application.commands.CreateUserCommand;
import com.example.project.shared.domain.annotations.ApplicationComponent;

@ApplicationComponent
public class CreateUserCommandHandler {

    public CreateUserCommandHandler() {
    }

    public void handle(CreateUserCommand command) {
        //todo: implement use case
    }
}
```

### Query

**FindUserByIdQuery.java** (`application/queries/`):
```java
package com.example.project.user.application.queries;

public record FindUserByIdQuery(
    // TODO: add query fields
) {
}
```

**FindUserByIdQueryHandler.java** (`application/usecases/`):
```java
package com.example.project.user.application.usecases;

import com.example.project.user.application.queries.FindUserByIdQuery;
import com.example.project.user.application.dtos.FindUserByIdResponseDto;
import com.example.project.shared.domain.annotations.ApplicationComponent;

@ApplicationComponent
public class FindUserByIdQueryHandler {

    public FindUserByIdQueryHandler() {
    }

    public FindUserByIdResponseDto handle(FindUserByIdQuery query) {
        //todo: implement use case
        return null;
    }
}
```

**FindUserByIdResponseDto.java** (`application/dtos/`):
```java
package com.example.project.user.application.dtos;

public record FindUserByIdResponseDto(
    // TODO: add response fields
) {
}
```

## Key Design Decisions

- **Pure Java records** — Commands and Queries are immutable records (no Lombok)
- **`@ApplicationComponent`** — Custom annotation from `shared` that marks handlers for Spring DI; not `@Service`
- **Handlers in `application/usecases/`** — All handlers live here regardless of type (Command or Query)
- **Commands in `application/commands/`** — Command record classes
- **Queries in `application/queries/`** — Query record classes
- **DTOs in `application/dtos/`** — Response DTOs (queries only)

## CQRS Pattern Guidelines

### Commands (Writes)
- **Purpose:** Change system state
- **Return:** `void` or minimal confirmation
- **Examples:** Create, Update, Delete, Activate, Deactivate

### Queries (Reads)
- **Purpose:** Retrieve data without side effects
- **Return:** ResponseDto or `List<ResponseDto>`
- **Examples:** FindById, FindAll, Search

## Common Use Cases

### User Module
```bash
eva g usecase user create-user         # Command
eva g usecase user update-user         # Command
eva g usecase user deactivate-user     # Command
eva g usecase user find-user-by-id     # Query
eva g usecase user find-user-by-email  # Query
```

### Order Module
```bash
eva g usecase order place-order              # Command
eva g usecase order cancel-order             # Command
eva g usecase order find-order-by-id         # Query
eva g usecase order find-orders-by-customer  # Query
```

### Product Module
```bash
eva g usecase product update-price     # Command
eva g usecase product update-stock     # Command
eva g usecase product find-by-category # Query
eva g usecase product get-low-stock    # Query
```

## Next Steps After Generation

1. **Add fields to the record:**
   ```java
   public record CreateUserCommand(
       String name,
       String email
   ) { }
   ```

2. **Implement the handler:**
   ```java
   public void handle(CreateUserCommand command) {
       User user = new User(command.name(), command.email());
       userRepository.save(user);
   }
   ```

3. **Wire into a Controller or another Handler** — inject the handler via constructor and call `handler.handle(command)`.

## Prerequisites

- Be in a project created with `eva create`
- Module must exist (`eva add module <module>`)
- Run the command from the project root

## See Also

- [generate-entities](./GENERATE_ENTITIES.md) — Generate complete domain model from YAML
- [generate-resource](./GENERATE_RESOURCE.md) — REST controller with 5 CRUD endpoints
- [add-module](./ADD_MODULE.md) — Create a new module
