# Command `generate record` (alias: `g record`)

---

## Table of Contents

1. [Description and purpose](#1-description-and-purpose)
2. [Syntax](#2-syntax)
3. [How it works](#3-how-it-works)
4. [Interactive prompts](#4-interactive-prompts)
5. [JSON type inference](#5-json-type-inference)
6. [Nested records](#6-nested-records)
7. [Generation modes](#7-generation-modes)
8. [Suffix by target folder](#8-suffix-by-target-folder)
9. [Generated output](#9-generated-output)
10. [Complete examples](#10-complete-examples)
11. [Prerequisites and common errors](#11-prerequisites-and-common-errors)

---

## 1. Description and purpose

`generate record` creates Java Record classes by **reading a JSON structure from the clipboard** and automatically inferring Java types. It handles nested objects and arrays by generating additional nested records.

It is designed for quickly scaffolding:
- Response DTOs
- Request/Command DTOs
- Query objects
- Event payloads

---

## 2. Syntax

```bash
eva generate record
eva g record          # short alias
```

No positional arguments. The record name and module are provided interactively.

### Passing JSON directly

```bash
eva g record '{"id":"123","name":"John"}'
```

When a string is passed as the first argument, it is treated as inline JSON instead of reading from the clipboard.

---

## 3. How it works

1. Reads JSON from the **clipboard** (or from the inline argument)
2. Shows a preview of the parsed JSON
3. Asks interactive questions (record name, module, target folder)
4. Infers Java types for every field
5. Detects nested objects and arrays and generates additional nested records
6. Asks for generation mode when nested records exist
7. Writes the generated `.java` files to the application layer of the selected module

---

## 4. Interactive prompts

| Prompt | Description |
|--------|-------------|
| **Record name** | Base name for the main record (e.g., `OrderResponse`) |
| **Target module** | One of the existing modules in the project |
| **Target folder** | `dtos`, `commands`, `queries`, or `events` |
| **Generation mode** | Only shown when nested records exist (see [section 7](#7-generation-modes)) |

---

## 5. JSON type inference

The generator maps JSON values to Java types using the following rules:

| JSON value | Java type |
|------------|-----------|
| `"hello"` | `String` |
| `"2024-01-15T10:30:00"` | `LocalDateTime` |
| `"2024-01-15"` | `LocalDate` |
| `"10:30:00"` | `LocalTime` |
| `"550e8400-e29b-41d4-a716..."` | `UUID` |
| `42` (integer) | `Integer` |
| `3.14` (decimal) | `Double` |
| `true` / `false` | `Boolean` |
| `null` | `Object` |
| `{ ... }` (object) | Nested Record |
| `[{ ... }]` (array of objects) | `List<NestedRecord>` |
| `["a", "b"]` (array of strings) | `List<String>` |
| `[1, 2]` (array of integers) | `List<Integer>` |

String detection for dates, times, and UUIDs is based on pattern matching against the value itself.

---

## 6. Nested records

When the JSON contains nested objects or arrays of objects, the generator automatically creates additional records for each nested type:

```json
{
  "id": "abc-123",
  "customer": {
    "id": 1,
    "name": "John"
  },
  "items": [
    {
      "productId": "PROD-1",
      "quantity": 2,
      "price": 9.99
    }
  ]
}
```

From this JSON, with record name `Order` and target folder `dtos`, the generator detects:

- **`OrderDto`** — main record
- **`CustomerDto`** — from the nested `customer` object
- **`ItemDto`** — from the `items` array (name is singularized automatically)

---

## 7. Generation modes

When nested records are detected, the generator asks how to write them:

| Mode | Description |
|------|-------------|
| **Separate files** | One `.java` file per record (default) |
| **Nested structure** | A single `.java` file with inner records declared inside the main record |

### Separate files (default)

```
application/dtos/
├── OrderDto.java
├── CustomerDto.java
└── ItemDto.java
```

### Nested structure

```
application/dtos/
└── OrderDto.java    ← contains CustomerDto and ItemDto as inner records
```

---

## 8. Suffix by target folder

The selected target folder determines the suffix automatically appended to each record name:

| Target folder | Suffix | Example |
|---------------|--------|---------|
| `dtos` | `Dto` | `OrderDto` |
| `commands` | `Command` | `OrderCommand` |
| `queries` | `Query` | `OrderQuery` |
| `events` | `Event` | `OrderEvent` |

The suffix is applied to all records, including nested ones.

---

## 9. Generated output

**Location:**

```
src/main/java/{package}/{module}/application/{targetFolder}/{RecordName}{Suffix}.java
```

**Example generated file** (`OrderDto.java`):

```java
package com.example.myapp.orders.application.dtos;

import java.util.List;
import java.util.UUID;

/**
 * OrderDto record
 * Generated from JSON
 */
public record OrderDto(
    UUID id,
    CustomerDto customer,
    List<ItemDto> items
) {
}
```

Imports for `java.time.*`, `java.util.UUID`, and `java.util.List` are added automatically when needed.

---

## 10. Complete examples

### Example 1: Simple DTO from clipboard

Copy this JSON to your clipboard:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "orderNumber": "ORD-001",
  "customerId": "CUST-123",
  "totalAmount": 149.99,
  "orderDate": "2024-01-15T10:30:00",
  "status": "CONFIRMED"
}
```

Run:

```bash
eva g record
```

Prompts:
- Record name: `OrderResponse`
- Module: `orders`
- Target folder: `dtos`

Generated `OrderResponseDto.java`:

```java
package com.example.myapp.orders.application.dtos;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * OrderResponseDto record
 * Generated from JSON
 */
public record OrderResponseDto(
    UUID id,
    String orderNumber,
    String customerId,
    Double totalAmount,
    LocalDateTime orderDate,
    String status
) {
}
```

---

### Example 2: Nested objects

Copy this JSON:

```json
{
  "id": 1,
  "customer": {
    "id": 42,
    "name": "John Doe",
    "email": "john@example.com"
  },
  "items": [
    {
      "productId": "PROD-1",
      "quantity": 2,
      "unitPrice": 9.99
    }
  ],
  "createdAt": "2024-01-15T10:30:00"
}
```

Run:

```bash
eva g record
```

Prompts:
- Record name: `Order`
- Module: `orders`
- Target folder: `dtos`
- Generation mode: `Separate files`

Generated files:

```
application/dtos/
├── OrderDto.java
├── CustomerDto.java
└── ItemDto.java
```

`OrderDto.java`:
```java
public record OrderDto(
    Integer id,
    CustomerDto customer,
    List<ItemDto> items,
    LocalDateTime createdAt
) {
}
```

---

### Example 3: Inline JSON

```bash
eva g record '{"id":1,"name":"Product A","price":29.99}'
```

---

## 11. Prerequisites and common errors

### Prerequisites

- Project created with `eva create`
- At least one module created (`eva add module <name>`)
- Valid JSON in the clipboard (or passed as the first argument)

### Common errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Failed to read or parse JSON from clipboard` | Clipboard is empty or contains invalid JSON | Copy valid JSON to clipboard before running the command |
| `Cannot generate record from empty array` | JSON is an empty array `[]` | Use an array with at least one element as template |
| `No modules found in project` | No modules exist yet | Run `eva add module <name>` first |
| `Module not found in filesystem` | Module is in config but missing on disk | Recreate the module with `eva add module <name>` |
