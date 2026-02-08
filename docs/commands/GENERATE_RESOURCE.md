# Command `generate resource` (alias: `g resource`)

## 📋 Description

Generates a complete REST controller with CRUD endpoints for an existing domain entity, following RESTful best practices.

## 🎯 Purpose

Quickly expose domain entities through a REST API with standard CRUD operations, reducing manual controller creation and ensuring consistency across endpoints.

## 📝 Syntax

```bash
eva4j generate resource <EntityName>
eva4j g resource <EntityName>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `EntityName` | Yes | Name of the entity (PascalCase, e.g., Customer, Product) |

## 💡 Examples

### Example 1: Customer Resource

```bash
eva4j g resource Customer
```

**Generates:**
```
infrastructure/rest/controllers/CustomerController.java
```

### Example 2: Product Resource

```bash
eva4j g resource Product
```

### Example 3: Order Resource

```bash
eva4j g resource Order
```

## 📦 Generated Code

**CustomerController.java:**
```java
package com.example.project.customer.infrastructure.rest.controllers;

import com.example.project.customer.application.commands.CreateCustomerCommand;
import com.example.project.customer.application.commands.CreateCustomerCommandHandler;
import com.example.project.customer.application.queries.GetCustomerQuery;
import com.example.project.customer.application.queries.GetCustomerQueryHandler;
import com.example.project.customer.application.queries.ListCustomersQuery;
import com.example.project.customer.application.queries.ListCustomersQueryHandler;
import com.example.project.customer.application.dtos.CustomerResponseDto;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * REST Controller for Customer resource
 */
@RestController
@RequestMapping("/api/customers")
@RequiredArgsConstructor
public class CustomerController {
    
    private final CreateCustomerCommandHandler createHandler;
    private final GetCustomerQueryHandler getHandler;
    private final ListCustomersQueryHandler listHandler;
    
    /**
     * Create a new customer
     * @param command Create customer command
     * @return Created customer
     */
    @PostMapping
    public ResponseEntity<CustomerResponseDto> create(@Valid @RequestBody CreateCustomerCommand command) {
        CustomerResponseDto response = createHandler.handle(command);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    /**
     * Get customer by ID
     * @param id Customer ID
     * @return Customer details
     */
    @GetMapping("/{id}")
    public ResponseEntity<CustomerResponseDto> getById(@PathVariable Long id) {
        GetCustomerQuery query = new GetCustomerQuery(id);
        CustomerResponseDto response = getHandler.handle(query);
        return ResponseEntity.ok(response);
    }
    
    /**
     * List all customers with pagination
     * @param pageable Pagination parameters
     * @return Page of customers
     */
    @GetMapping
    public ResponseEntity<Page<CustomerResponseDto>> list(Pageable pageable) {
        ListCustomersQuery query = new ListCustomersQuery(pageable);
        Page<CustomerResponseDto> response = listHandler.handle(query);
        return ResponseEntity.ok(response);
    }
}
```

## ✨ Features

### REST Endpoints

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| POST | `/api/{entity}` | Create new entity | `CreateCommand` | `201 Created` + DTO |
| GET | `/api/{entity}/{id}` | Get by ID | - | `200 OK` + DTO |
| GET | `/api/{entity}` | List all (paginated) | - | `200 OK` + Page<DTO> |

### Built-in Features
- ✅ **Pagination Support** - Uses Spring Data `Pageable`
- ✅ **Validation** - `@Valid` on request bodies
- ✅ **HTTP Status Codes** - Correct status codes (201, 200)
- ✅ **JavaDoc** - Complete endpoint documentation
- ✅ **Dependency Injection** - Handlers injected via constructor
- ✅ **RESTful Design** - Follows REST conventions

## 🌐 API Usage Examples

### Create Entity
```bash
curl -X POST http://localhost:8080/api/customers \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com"
  }'
```

**Response:** `201 Created`
```json
{
  "id": 1,
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "createdAt": "2026-02-04T10:30:00"
}
```

### Get by ID
```bash
curl http://localhost:8080/api/customers/1
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com"
}
```

### List All (Paginated)
```bash
curl "http://localhost:8080/api/customers?page=0&size=10&sort=firstName,asc"
```

**Response:** `200 OK`
```json
{
  "content": [
    {
      "id": 1,
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com"
    }
  ],
  "pageable": {
    "pageNumber": 0,
    "pageSize": 10
  },
  "totalElements": 1,
  "totalPages": 1
}
```

## 🔄 Integration with CQRS

The generated controller integrates with existing CQRS handlers:

```
Controller (REST Layer)
    ↓
Command/Query Handlers (Application Layer)
    ↓
Domain Repositories (Domain Layer)
    ↓
JPA Repositories (Infrastructure Layer)
    ↓
Database
```

## 🚀 Next Steps

After generating the resource:

1. **Test the endpoints:**
   ```bash
   ./gradlew bootRun
   # Use Postman, curl, or browser
   ```

2. **Add additional endpoints:**
   ```java
   @PutMapping("/{id}")
   public ResponseEntity<CustomerResponseDto> update(
       @PathVariable Long id,
       @Valid @RequestBody UpdateCustomerCommand command) {
       command.setId(id);
       CustomerResponseDto response = updateHandler.handle(command);
       return ResponseEntity.ok(response);
   }
   
   @DeleteMapping("/{id}")
   public ResponseEntity<Void> delete(@PathVariable Long id) {
       DeleteCustomerCommand command = new DeleteCustomerCommand(id);
       deleteHandler.handle(command);
       return ResponseEntity.noContent().build();
   }
   ```

3. **Add custom queries:**
   ```java
   @GetMapping("/search")
   public ResponseEntity<List<CustomerResponseDto>> search(
       @RequestParam String query) {
       // Implement search logic
   }
   ```

4. **Add exception handling:**
   ```java
   @ExceptionHandler(EntityNotFoundException.class)
   public ResponseEntity<ErrorResponse> handleNotFound(EntityNotFoundException ex) {
       return ResponseEntity.status(HttpStatus.NOT_FOUND)
           .body(new ErrorResponse(ex.getMessage()));
   }
   ```

## 🎯 Common Customizations

### Add Update Endpoint
```java
@PutMapping("/{id}")
public ResponseEntity<CustomerResponseDto> update(
    @PathVariable Long id,
    @Valid @RequestBody UpdateCustomerCommand command) {
    command.setId(id);
    CustomerResponseDto response = updateHandler.handle(command);
    return ResponseEntity.ok(response);
}
```

### Add Delete Endpoint
```java
@DeleteMapping("/{id}")
@ResponseStatus(HttpStatus.NO_CONTENT)
public void delete(@PathVariable Long id) {
    DeleteCustomerCommand command = new DeleteCustomerCommand(id);
    deleteHandler.handle(command);
}
```

### Add Search Endpoint
```java
@GetMapping("/search")
public ResponseEntity<List<CustomerResponseDto>> search(
    @RequestParam String email) {
    SearchCustomersQuery query = new SearchCustomersQuery(email);
    List<CustomerResponseDto> response = searchHandler.handle(query);
    return ResponseEntity.ok(response);
}
```

### Add Partial Update (PATCH)
```java
@PatchMapping("/{id}")
public ResponseEntity<CustomerResponseDto> partialUpdate(
    @PathVariable Long id,
    @RequestBody Map<String, Object> updates) {
    // Implement partial update logic
}
```

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist
- Entity must be generated with `eva4j g entities`
- Command/Query handlers must exist

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Entity name is in PascalCase
- ✅ Module exists
- ✅ Entity exists in domain layer

## 📚 See Also

- [generate-entities](./GENERATE_ENTITIES.md) - Generate entities first
- [generate-usecase](./GENERATE_USECASE.md) - Add custom use cases
- [add-module](./ADD_MODULE.md) - Create modules

## 🐛 Troubleshooting

**Error: "Entity not found"**
- Solution: Run `eva4j g entities <aggregate>` first to create the entity

**Error: "Handlers not found"**
- Solution: Ensure command and query handlers exist (generated with entities)

**404 when calling endpoints**
- Solution: Verify the application is running and the base path is correct
- Check `server.port` and `server.servlet.context-path` in `application.yaml`

**Validation errors ignored**
- Solution: Add `@Valid` annotation to request body parameters
- Ensure validation annotations are present on command classes
