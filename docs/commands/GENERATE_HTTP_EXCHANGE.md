# Command `generate http-exchange` (alias: `g http-exchange`)

## Description

Generates an HTTP client adapter using Spring Cloud OpenFeign for consuming external REST APIs, following hexagonal architecture.

## Purpose

Enable modules to communicate with external HTTP services through a clean, declarative interface while maintaining architectural boundaries (Port → Adapter → FeignClient).

## Syntax

```bash
eva generate http-exchange <module> [port-name]
eva g http-exchange <module> [port-name]    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Module that will own the HTTP client (e.g., `order`, `payment`) |
| `port-name` | No | Name of the external service in PascalCase — prompted if omitted |

> **Interactive prompts:**
> 1. **Port name** — if not provided (e.g., `PaymentGateway`, `ProductService`)
> 2. **Base URL** — default URL of the remote service for local environment

## Examples

### Example 1: Payment gateway in the order module

```bash
eva g http-exchange order payment-gateway
```

Generates:
- `order/application/ports/PaymentGateway.java`
- `order/infrastructure/adapters/paymentGateway/PaymentGatewayAdapter.java`
- `order/infrastructure/adapters/paymentGateway/PaymentGatewayFeignClient.java`
- `order/infrastructure/adapters/paymentGateway/PaymentGatewayConfig.java`
- Adds entry to `parameters/*/urls.yaml`

### Example 2: User service client

```bash
eva g http-exchange order user-service
```

### Example 3: Inventory service

```bash
eva g http-exchange product inventory-service
```

## Generated Code Structure

```
<module>/
├── application/
│   └── ports/
│       └── PaymentGateway.java              # Port interface
│
└── infrastructure/
    └── adapters/
        └── paymentGateway/
            ├── PaymentGatewayAdapter.java   # Adapter (@Component)
            ├── PaymentGatewayFeignClient.java  # Feign client
            └── PaymentGatewayConfig.java    # Feign config (timeouts)
```

## Generated Files

### 1. Port (Application Layer)

**PaymentGateway.java** (`application/ports/`):
```java
package com.example.project.order.application.ports;

public interface PaymentGateway {

  Object findAll();

  Object findById(Long id);

  Object create(Object request);

  Object update(Long id, Object request);

  void delete(Long id);
}
```

> The port exposes generic `Object` methods as scaffolding. Replace them with typed methods that match the remote API contract.

### 2. Feign Client (Infrastructure)

**PaymentGatewayFeignClient.java** (`infrastructure/adapters/paymentGateway/`):
```java
package com.example.project.order.infrastructure.adapters.paymentGateway;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

@FeignClient(
    name = "order-payment-gateway",
    url = "${order.payment-gateway.base-url}",
    configuration = PaymentGatewayConfig.class
)
public interface PaymentGatewayFeignClient {

  @GetMapping("/api/resources")
  Object findAll();

  @GetMapping("/api/resources/{id}")
  Object findById(@PathVariable("id") Long id);

  @PostMapping("/api/resources")
  Object create(@RequestBody Object request);

  @PutMapping("/api/resources/{id}")
  Object update(@PathVariable("id") Long id, @RequestBody Object request);

  @DeleteMapping("/api/resources/{id}")
  void delete(@PathVariable("id") Long id);
}
```

> Property key format: `<module-kebab>.<port-kebab>.base-url`

### 3. Config (Infrastructure)

**PaymentGatewayConfig.java** (`infrastructure/adapters/paymentGateway/`):
```java
package com.example.project.order.infrastructure.adapters.paymentGateway;

import feign.Logger;
import feign.Request;
import org.springframework.context.annotation.Bean;

import java.util.concurrent.TimeUnit;

public class PaymentGatewayConfig {

  @Bean
  public Logger.Level feignLoggerLevel() {
    return Logger.Level.BASIC;
  }

  @Bean
  public Request.Options feignOptions() {
    return new Request.Options(
      15, TimeUnit.SECONDS,   // connect timeout
      15, TimeUnit.SECONDS,   // read timeout
      true
    );
  }
}
```

> **No `@Configuration` annotation** — the class is referenced directly via `configuration = PaymentGatewayConfig.class` in the `@FeignClient`, which is the standard OpenFeign pattern.

### 4. Adapter (Infrastructure)

**PaymentGatewayAdapter.java** (`infrastructure/adapters/paymentGateway/`):
```java
package com.example.project.order.infrastructure.adapters.paymentGateway;

import com.example.project.order.application.ports.PaymentGateway;
import org.springframework.stereotype.Component;

@Component
public class PaymentGatewayAdapter implements PaymentGateway {

  private final PaymentGatewayFeignClient feignClient;

  public PaymentGatewayAdapter(PaymentGatewayFeignClient feignClient) {
    this.feignClient = feignClient;
  }

  @Override
  public Object findAll() {
    return feignClient.findAll();
  }

  @Override
  public Object findById(Long id) {
    return feignClient.findById(id);
  }

  @Override
  public Object create(Object request) {
    return feignClient.create(request);
  }

  @Override
  public Object update(Long id, Object request) {
    return feignClient.update(id, request);
  }

  @Override
  public void delete(Long id) {
    feignClient.delete(id);
  }
}
```

## Configuration Added

The command appends the base URL to every environment's `urls.yaml`:

```yaml
# parameters/local/urls.yaml
order:
  payment-gateway:
    base-url: http://localhost:8050   # value entered at prompt

# parameters/develop/urls.yaml
order:
  payment-gateway:
    base-url: https://dev-payment.company.com
```

Property key pattern: `<module-kebab>.<port-kebab>.base-url`

## Usage in Code

Inject the Port interface (not the FeignClient directly):

```java
@ApplicationComponent
public class ProcessPaymentCommandHandler {

    private final PaymentGateway paymentGateway;  // ← Port interface

    public ProcessPaymentCommandHandler(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }

    public void handle(ProcessPaymentCommand command) {
        paymentGateway.create(command);
    }
}
```

## Customization

After generation, replace the generic `Object` signatures with typed DTOs:

```java
// Port
PaymentResponse processPayment(PaymentRequest request);

// FeignClient
@PostMapping("/payments")
PaymentResponse processPayment(@RequestBody PaymentRequest request);

// Adapter
@Override
public PaymentResponse processPayment(PaymentRequest request) {
    return feignClient.processPayment(request);
}
```

## Prerequisites

- Be in a project created with `eva create`
- Module must exist (`eva add module <module>`)
- `spring-cloud-openfeign` dependency must be present (included by default in eva projects)

## See Also

- [generate-kafka-event](./GENERATE_KAFKA_EVENT.md) — Async event publishing
- [add-module](./ADD_MODULE.md) — Create a new module
