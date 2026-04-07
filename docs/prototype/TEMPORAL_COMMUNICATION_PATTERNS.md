# Patrones de Comunicación entre Microservicios con Temporal

## 📋 Propósito

Cuando Temporal actúa como broker de orquestación, los microservicios se comunican de formas distintas según el caso de uso. Este documento describe los **4 patrones principales**, cuándo usar cada uno, y ejemplos concretos aplicados a un e-commerce.

---

## 🔄 Resumen Comparativo

| Patrón | Acoplamiento | Dirección | Espera respuesta | Caso de uso |
|--------|-------------|-----------|------------------|-------------|
| **Remote Activity** | Medio | Request → Response | ✅ Sí (bloqueante) | Operaciones atómicas cross-service |
| **Remote Activity + Async** | Medio | Request → Response (paralelo) | ✅ Sí (no bloqueante) | Múltiples operaciones independientes en paralelo |
| **Child Workflow** | Alto | Parent → Child | ✅ Sí | Subprocesos con ciclo de vida propio |
| **Signal External** | Bajo | Fire & Forget | ❌ No | Notificaciones entre workflows activos |
| **Signal + Await** | Bajo | Bidireccional | ✅ Sí (con espera) | Esperar evento externo con timeout |

---

## 1. Remote Activity

### Concepto

Un workflow en el **Servicio A** invoca una actividad cuya implementación vive en el **Servicio B**. Temporal enruta la tarea al worker correcto a través del **Task Queue**. No hay HTTP entre servicios.

```
Servicio A (workflow)         Temporal Server         Servicio B (worker)
       │                            │                         │
       │  stub.doSomething(data)    │                         │
       │───────────────────────────►│                         │
       │                            │  tarea en QUEUE_B ─────►│
       │                            │                         │  ejecuta con acceso a BD
       │                            │  resultado ◄────────────│
       │  resultado ◄───────────────│                         │
```

### Cuándo usarlo

- Operaciones **atómicas** y **sin ciclo de vida propio**
- El workflow necesita el resultado para continuar
- Lectura de datos de otro servicio
- Escritura simple en otro servicio

### Ejemplo: Orders invoca una actividad de Inventory

**Interfaz compartida** (en módulo `shared` o artefacto de contrato):

```java
@ActivityInterface
public interface InventoryActivity {
    ReserveResult reserveStock(String orderId, List<ItemRequest> items);
    void releaseStock(String reservationId);
}
```

**Implementación** (vive en el microservicio `inventory`):

```java
public class InventoryActivityImpl implements InventoryActivity {

    private final InventoryRepository inventoryRepository;

    @Override
    public ReserveResult reserveStock(String orderId, List<ItemRequest> items) {
        // Acceso directo a la BD de inventory
        for (ItemRequest item : items) {
            Product product = inventoryRepository.findById(item.getProductId())
                .orElseThrow(() -> new ProductNotFoundException(item.getProductId()));
            product.reserve(item.getQuantity());
            inventoryRepository.save(product);
        }
        String reservationId = UUID.randomUUID().toString();
        return new ReserveResult(reservationId, orderId);
    }

    @Override
    public void releaseStock(String reservationId) {
        // Compensación: liberar stock reservado
    }
}
```

**Worker** (registra la activity en el microservicio `inventory`):

```java
Worker inventoryWorker = workerFactory.newWorker("INVENTORY_QUEUE");
inventoryWorker.registerActivitiesImplementations(
    new InventoryActivityImpl(inventoryRepository)
);
```

**Invocación desde el workflow** (en el microservicio `orders`):

```java
public class PlaceOrderWorkFlowImpl implements PlaceOrderWorkFlow {

    // Stub que apunta al queue de inventory — NO es HTTP
    private final InventoryActivity inventoryActivities = Workflow.newActivityStub(
        InventoryActivity.class,
        ActivityOptions.newBuilder()
            .setTaskQueue("INVENTORY_QUEUE")
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .setRetryOptions(RetryOptions.newBuilder()
                .setMaximumAttempts(3)
                .build())
            .build()
    );

    @Override
    public void start(String orderId) {
        // Esto viaja por Temporal, no por HTTP
        ReserveResult reserved = inventoryActivities.reserveStock(orderId, items);

        // Registrar compensación en la Saga
        saga.addCompensation(() -> inventoryActivities.releaseStock(reserved.getReservationId()));

        // Continuar con el siguiente paso...
    }
}
```

### Qué necesita cada microservicio

```
orders (invocador):
  ├── InventoryActivity.java       ← interfaz (solo el contrato)
  ├── ReserveResult.java           ← DTO de respuesta
  └── ItemRequest.java             ← DTO de entrada

inventory (ejecutor):
  ├── InventoryActivity.java       ← interfaz (misma)
  ├── InventoryActivityImpl.java   ← implementación con acceso a BD
  └── InventoryWorker.java         ← registra la activity en el queue
```

### Variante: Ejecución Paralela con `Async.function()`

Por defecto, Remote Activity es **bloqueante** — el workflow se detiene hasta recibir el resultado. Sin embargo, cuando necesitas invocar múltiples actividades que son **independientes entre sí**, puedes ejecutarlas en paralelo usando `Async.function()`.

```
Secuencial (default):                    Paralelo (Async.function):

  reserveStock()  ──────► 2s             reserveStock()  ───► 2s ──┐
  validateAddress() ─────► 1s             validateAddress() ──► 1s ──┤ max(2s, 1s, 1.5s) = 2s
  checkFraud() ──────────► 1.5s           checkFraud() ───────► 1.5s┘
  ─────────────────────────               ─────────────────────────
  Total: 4.5s                             Total: 2s
```

**Ejemplo: Validaciones paralelas antes de confirmar una orden**

```java
public class PlaceOrderWorkFlowImpl implements PlaceOrderWorkFlow {

    private final InventoryActivity inventoryActivities = Workflow.newActivityStub(
        InventoryActivity.class,
        ActivityOptions.newBuilder()
            .setTaskQueue("INVENTORY_HEAVY_TASK_QUEUE")
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .build()
    );

    private final ShippingActivity shippingActivities = Workflow.newActivityStub(
        ShippingActivity.class,
        ActivityOptions.newBuilder()
            .setTaskQueue("SHIPPING_LIGHT_TASK_QUEUE")
            .setStartToCloseTimeout(Duration.ofSeconds(10))
            .build()
    );

    private final RiskActivity riskActivities = Workflow.newActivityStub(
        RiskActivity.class,
        ActivityOptions.newBuilder()
            .setTaskQueue("RISK_LIGHT_TASK_QUEUE")
            .setStartToCloseTimeout(Duration.ofSeconds(15))
            .build()
    );

    @Override
    public void start(String orderId) {
        // Lanzar las 3 actividades en paralelo — NO bloquean individualmente
        Promise<ReserveResult> stockPromise = Async.function(
            inventoryActivities::reserveStock, orderId, items
        );
        Promise<AddressValidation> addressPromise = Async.function(
            shippingActivities::validateAddress, shippingAddress
        );
        Promise<FraudScore> fraudPromise = Async.function(
            riskActivities::quickCheck, orderId, totalAmount
        );

        // Esperar TODAS — el workflow se bloquea aquí hasta que las 3 terminen
        ReserveResult reserved = stockPromise.get();
        AddressValidation address = addressPromise.get();
        FraudScore fraud = fraudPromise.get();

        // Con los 3 resultados, tomar decisión
        if (fraud.isRejected()) {
            inventoryActivities.releaseStock(reserved.getReservationId());
            throw ApplicationFailure.newFailure("Fraud detected", "FRAUD");
        }

        // Continuar con el flujo...
    }
}
```

**API de `Promise`:**

| Método | Comportamiento |
|--------|---------------|
| `promise.get()` | Bloquea el workflow hasta que la actividad termine. Propaga excepciones. |
| `Promise.allOf(p1, p2, p3)` | Retorna un `Promise<Void>` que se completa cuando **todas** terminan. |
| `Promise.anyOf(p1, p2, p3)` | Retorna un `Promise<Object>` que se completa cuando **la primera** termina. |

**`Promise.allOf` — espera explícita con manejo unificado:**

```java
Promise.allOf(stockPromise, addressPromise, fraudPromise).get();  // espera las 3

// Ahora todos los .get() son inmediatos (ya completaron)
ReserveResult reserved = stockPromise.get();
AddressValidation address = addressPromise.get();
FraudScore fraud = fraudPromise.get();
```

**`Promise.anyOf` — patrón race (el primero gana):**

```java
// Útil para failover: consultar múltiples proveedores, usar el primero que responda
Promise<ShippingRate> dhlPromise = Async.function(dhlActivities::getRate, pkg);
Promise<ShippingRate> fedexPromise = Async.function(fedexActivities::getRate, pkg);

Promise<Object> first = Promise.anyOf(dhlPromise, fedexPromise);
first.get();  // espera al primero

ShippingRate rate = dhlPromise.isCompleted()
    ? dhlPromise.get()
    : fedexPromise.get();
```

### Cuándo usar `Async.function()` vs secuencial

| Criterio | Secuencial (default) | Paralelo (`Async.function`) |
|----------|---------------------|------------------------------|
| Actividades **dependen** una de otra | ✅ Usar | ❌ No aplica |
| Actividades **independientes** | ❌ Desperdicia tiempo | ✅ Usar |
| Compensación en Saga | Registrar después de cada `.get()` | Registrar después de `Promise.allOf()` |
| Manejo de errores | Falla en el paso, compensa lo anterior | Una falla cancela las pendientes si usas `CancellationScope` |

> **Nota importante:** `Async.function()` es parte del SDK de Temporal y es **determinista** — seguro de usar dentro de workflows. No confundir con `CompletableFuture` de Java, que NO es determinista y está prohibido en workflows Temporal.

### En Temporal Web UI

Aparecen como una **actividad normal** dentro del workflow. No se distingue de una actividad local. Cuando se usa `Async.function()`, las actividades paralelas aparecen como múltiples `ActivityTaskScheduled` events casi simultáneos en el historial.

---

## 2. Child Workflow

### Concepto

Un workflow en el **Servicio A** lanza un **sub-workflow** que puede vivir en el **Servicio B**. El child tiene su propio historial, puede ser cancelado independientemente, y el padre puede esperar su resultado o continuar sin esperarlo.

```
Servicio A (parent workflow)      Temporal Server      Servicio B (child workflow)
       │                                │                         │
       │  childStub.start(data)         │                         │
       │───────────────────────────────►│                         │
       │                                │  nueva ejecución ──────►│
       │                                │                         │  ejecuta pasos
       │                                │                         │  propios (activities,
       │                                │                         │  signals, timers)
       │                                │  resultado ◄────────────│
       │  resultado ◄───────────────────│                         │
```

### Cuándo usarlo

- El subproceso tiene **ciclo de vida propio** (puede cancelarse, consultarse, reintentar)
- El subproceso tiene **lógica compleja** con múltiples pasos internos
- Necesitas **limitar el alcance de la cancelación** (cancelar el child sin cancelar el parent)
- El historial del parent sería demasiado largo si incluyera todo inline

### Ejemplo: PlaceOrder lanza ProcessPayment como child

**Interfaz del child** (compartida):

```java
@WorkflowInterface
public interface ProcessPaymentWorkFlow {

    @WorkflowMethod
    PaymentResult start(PaymentRequest request);

    @SignalMethod
    void onThreeDSecureCompleted(String verificationToken);

    @QueryMethod
    String getPaymentStatus();
}
```

**Implementación** (vive en el microservicio `payments`):

```java
public class ProcessPaymentWorkFlowImpl implements ProcessPaymentWorkFlow {

    private final PaymentActivity paymentActivities = Workflow.newActivityStub(
        PaymentActivity.class,
        ActivityOptions.newBuilder()
            .setTaskQueue("PAYMENT_QUEUE")
            .setStartToCloseTimeout(Duration.ofSeconds(60))
            .build()
    );

    private String status = "PENDING";
    private String verificationToken = null;

    @Override
    public PaymentResult start(PaymentRequest request) {

        // 1. Intentar cobro
        ChargeResult charge = paymentActivities.charge(request);

        // 2. Si requiere 3D Secure, esperar verificación del usuario
        if (charge.isRequires3DSecure()) {
            status = "AWAITING_VERIFICATION";

            // Espera hasta 10 minutos que el usuario complete 3D Secure
            boolean verified = Workflow.await(
                Duration.ofMinutes(10),
                () -> this.verificationToken != null
            );

            if (!verified) {
                status = "TIMEOUT";
                return new PaymentResult(null, "TIMEOUT");
            }

            // Confirmar con el token de verificación
            charge = paymentActivities.confirmWithVerification(
                charge.getTransactionId(), verificationToken
            );
        }

        status = "COMPLETED";
        return new PaymentResult(charge.getTransactionId(), "SUCCESS");
    }

    @Override
    public void onThreeDSecureCompleted(String token) {
        this.verificationToken = token;
    }

    @Override
    public String getPaymentStatus() {
        return status;
    }
}
```

**Invocación desde el parent** (en el microservicio `orders`):

```java
public class PlaceOrderWorkFlowImpl implements PlaceOrderWorkFlow {

    @Override
    public void start(String orderId) {
        // ... reservar stock ...

        // Lanzar pago como child workflow
        ProcessPaymentWorkFlow paymentWorkflow = Workflow.newChildWorkflowStub(
            ProcessPaymentWorkFlow.class,
            ChildWorkflowOptions.newBuilder()
                .setWorkflowId("payment-" + orderId)
                .setTaskQueue("PAYMENT_FLOW_QUEUE")
                .build()
        );

        // Espera el resultado del child (bloqueante para el parent)
        PaymentResult result = paymentWorkflow.start(
            new PaymentRequest(orderId, totalAmount, paymentToken)
        );

        if (!"SUCCESS".equals(result.getStatus())) {
            saga.compensate();  // Fallo en pago → compensar stock
            return;
        }

        saga.addCompensation(() -> paymentActivities.refund(result.getPaymentId()));

        // Continuar: confirmar orden...
    }
}
```

### Diferencia clave con Remote Activity

```
Remote Activity:
  - Una operación: charge() → resultado
  - Sin estado interno
  - Sin signals ni queries

Child Workflow:
  - Múltiples pasos: charge() → esperar 3D Secure → confirm()
  - Estado interno (status, verificationToken)
  - Acepta signals (onThreeDSecureCompleted)
  - Se puede consultar (getPaymentStatus)
  - Historial propio en Temporal Web
```

### En Temporal Web UI

Aparecen como **dos ejecuciones vinculadas**: el parent muestra un evento `ChildWorkflowExecutionStarted` y el child tiene su propio historial completo con todos sus pasos internos.

---

## 3. Signal External (Fire & Forget)

### Concepto

Un servicio envía una **señal** a un workflow que ya está corriendo en otro servicio. No espera respuesta. El emisor solo necesita conocer el `workflowId` del receptor.

```
Servicio A                   Temporal Server              Servicio B (workflow activo)
       │                            │                              │
       │  signal(workflowId, data)  │                              │
       │───────────────────────────►│                              │
       │                            │  entrega el signal ─────────►│
       │  (continúa sin esperar)    │                              │  procesa el signal
       │                            │                              │
```

### Cuándo usarlo

- Avisar a un workflow activo que **algo pasó**
- No necesitas respuesta del receptor
- Los servicios son **completamente independientes**
- Comunicación basada en eventos entre workflows

### Ejemplo: Webhook de pagos notifica al workflow de orders

**Escenario:** El usuario completó el pago en una pasarela externa (PayPal, 3D Secure). La pasarela llama a un webhook en el microservicio `payments`. Este debe avisar al workflow `PlaceOrder` en el microservicio `orders` que el pago fue exitoso.

**Receptor — workflow en orders** (ya está corriendo y esperando):

```java
@WorkflowInterface
public interface PlaceOrderWorkFlow {

    @WorkflowMethod
    void start(String cartId, String paymentToken);

    @SignalMethod
    void paymentCompleted(String paymentId);
}

public class PlaceOrderWorkFlowImpl implements PlaceOrderWorkFlow {

    private String paymentId = null;

    @Override
    public void start(String cartId, String paymentToken) {
        // ... pasos previos (reservar stock, etc.) ...

        // Esperar señal de pago (máximo 30 minutos)
        boolean paid = Workflow.await(
            Duration.ofMinutes(30),
            () -> this.paymentId != null
        );

        if (!paid) {
            saga.compensate();  // timeout → liberar stock
            return;
        }

        // Pago recibido, continuar
        orderActivities.confirmOrder(orderId, this.paymentId);
    }

    @Override
    public void paymentCompleted(String paymentId) {
        this.paymentId = paymentId;  // desbloquea el await
    }
}
```

**Emisor — webhook controller en payments:**

```java
@RestController
public class PaymentWebhookController {

    private final WorkflowClient workflowClient;

    // POST /webhooks/payments (llamado por la pasarela externa)
    @PostMapping("/webhooks/payments")
    public ResponseEntity<Void> handlePaymentWebhook(@RequestBody PaymentNotification notification) {

        // El workflowId se guardó cuando se inició el checkout
        String workflowId = notification.getMetadata().get("workflowId");

        // Enviar signal al workflow de orders — fire & forget
        PlaceOrderWorkFlow workflow = workflowClient.newUntypedWorkflowStub(workflowId)
            .signal("paymentCompleted", notification.getPaymentId());

        return ResponseEntity.ok().build();
    }
}
```

**Alternativa sin conocer la interfaz** (acoplamiento mínimo):

```java
// Signal sin tipar — solo necesitas el workflowId y el nombre del signal
workflowClient.newUntypedWorkflowStub(workflowId)
    .signal("paymentCompleted", paymentId);
```

### Qué necesita cada microservicio

```
payments (emisor):
  ├── WorkflowClient         ← del SDK de Temporal
  └── workflowId             ← guardado cuando se inició el checkout

orders (receptor):
  └── @SignalMethod en su workflow  ← define qué signals acepta
```

**El emisor NO necesita la interfaz del receptor** si usa `newUntypedWorkflowStub`. Es el patrón de menor acoplamiento.

### En Temporal Web UI

Aparece como un evento `WorkflowSignaled` en el historial del workflow receptor. En el emisor no queda registro (es fire & forget desde su perspectiva).

---

## 4. Signal + Await (Espera con Timeout)

### Concepto

Combina Signal External con `Workflow.await()` para crear un patrón **request-wait** entre servicios. Un workflow envía un signal y luego espera que el otro le responda con otro signal.

```
Servicio A (workflow)         Temporal Server         Servicio B (workflow)
       │                            │                         │
       │  signal → B                │                         │
       │───────────────────────────►│────────────────────────►│
       │                            │                         │
       │  await(timeout)            │                         │  procesa...
       │  zzz...                    │                         │
       │                            │                         │
       │                            │  signal → A ◄───────────│
       │  ◄─────────────────────────│                         │
       │  (despierta y continúa)    │                         │
```

### Cuándo usarlo

- Necesitas respuesta de otro servicio pero **no quieres bloquear con una activity**
- El otro servicio puede tardar minutos, horas o días
- Necesitas un **timeout** si la respuesta no llega
- Útil para aprobaciones humanas, verificaciones externas, procesos batch

### Ejemplo: Orders solicita aprobación de fraude a Risk

```java
// En PlaceOrderWorkFlowImpl (orders)
private FraudCheckResult fraudResult = null;

@Override
public void start(String orderId) {
    // ... crear orden, reservar stock ...

    // Solicitar análisis de fraude (signal al servicio de risk)
    String riskWorkflowId = "risk-check-" + orderId;

    // Iniciar el workflow de risk assessment
    RiskAssessmentWorkFlow riskWorkflow = workflowClient.newWorkflowStub(
        RiskAssessmentWorkFlow.class,
        WorkflowOptions.newBuilder()
            .setWorkflowId(riskWorkflowId)
            .setTaskQueue("RISK_QUEUE")
            .build()
    );
    WorkflowClient.start(riskWorkflow::assess, orderId, orderAmount);

    // Esperar resultado (máximo 5 minutos)
    boolean received = Workflow.await(
        Duration.ofMinutes(5),
        () -> this.fraudResult != null
    );

    if (!received) {
        // Timeout: decidir política (aprobar por defecto o rechazar)
        orderActivities.flagForManualReview(orderId);
        return;
    }

    if (fraudResult.isRejected()) {
        saga.compensate();
        return;
    }

    // Aprobado → continuar con cobro
    paymentActivities.charge(orderId, totalAmount, paymentToken);
}

@SignalMethod
public void onFraudCheckCompleted(FraudCheckResult result) {
    this.fraudResult = result;
}
```

```java
// En RiskAssessmentWorkFlowImpl (risk)
@Override
public void assess(String orderId, BigDecimal amount) {
    // Análisis que puede tardar...
    FraudScore score = riskActivities.analyzeTransaction(orderId, amount);

    FraudCheckResult result = new FraudCheckResult(
        score.isAboveThreshold() ? "REJECTED" : "APPROVED"
    );

    // Enviar resultado de vuelta al workflow de orders
    String orderWorkflowId = "PlaceOrderWorkFlow-" + orderId;
    workflowClient.newUntypedWorkflowStub(orderWorkflowId)
        .signal("onFraudCheckCompleted", result);
}
```

---

## 🎯 Árbol de Decisión

```
¿Necesito datos/resultado del otro servicio?
│
├─ NO → Signal External (fire & forget)
│       Ejemplo: avisar que un pago se completó
│
└─ SÍ
   │
   ├─ ¿La operación es simple y rápida (< 2 min)?
   │  │
   │  ├─ ¿Solo una operación, o varias que dependen entre sí?
   │  │  └─ SÍ → Remote Activity (secuencial)
   │  │          Ejemplo: reservar stock, leer un carrito, crear un registro
   │  │
   │  └─ ¿Múltiples operaciones independientes que puedo lanzar a la vez?
   │     └─ SÍ → Remote Activity + Async.function() (paralelo)
   │             Ejemplo: reservar stock + validar dirección + check fraude
   │
   └─ ¿La operación tiene múltiples pasos, estado interno, o puede tardar mucho?
      │
      ├─ ¿Necesito controlar su ciclo de vida (cancelar, consultar estado)?
      │  └─ SÍ → Child Workflow
      │          Ejemplo: proceso de pago con 3D Secure, fulfillment multi-paso
      │
      └─ ¿Solo necesito esperar una respuesta eventual?
         └─ SÍ → Signal + Await
                 Ejemplo: aprobación de fraude, validación humana
```

---

## 📊 E-commerce: Qué patrón usa cada comunicación

```
PlaceOrderWorkFlow (orders)
│
├── cartActivities.fetchCart()                  → Remote Activity (carts)
├── orderActivities.createDraft()               → Remote Activity (orders, local)
├── inventoryActivities.reserveStock()          → Remote Activity (inventory)
│
├── ProcessPaymentWorkFlow                      → Child Workflow (payments)
│   ├── paymentActivities.charge()              → Remote Activity (payments, local)
│   └── await 3DSecure signal                   → Signal + Await (webhook externo)
│
├── orderActivities.confirmOrder()              → Remote Activity (orders, local)
├── cartActivities.markCheckedOut()             → Remote Activity (carts)
├── notificationActivities.sendConfirmation()   → Remote Activity (notifications)
│
└── [si falla] saga.compensate()
    ├── inventoryActivities.releaseStock()      → Remote Activity (inventory)
    └── paymentActivities.refund()              → Remote Activity (payments)
```

---

## 🔧 Notas Técnicas

### Task Queues

Each microservicio escucha en sus propias colas con prefijo de módulo:

```
orders:        ORDER_WORKFLOW_QUEUE, ORDER_LIGHT_TASK_QUEUE, ORDER_HEAVY_TASK_QUEUE
carts:         CART_LIGHT_TASK_QUEUE, CART_HEAVY_TASK_QUEUE
inventory:     INVENTORY_LIGHT_TASK_QUEUE, INVENTORY_HEAVY_TASK_QUEUE
payments:      PAYMENT_WORKFLOW_QUEUE, PAYMENT_LIGHT_TASK_QUEUE, PAYMENT_HEAVY_TASK_QUEUE
notifications: NOTIFICATION_WORKFLOW_QUEUE, NOTIFICATION_LIGHT_TASK_QUEUE
shipping:      SHIPPING_LIGHT_TASK_QUEUE, SHIPPING_HEAVY_TASK_QUEUE
```

### Qué comparten los servicios

```
Remote Activity:   Interfaz (@ActivityInterface) + DTOs
Child Workflow:    Interfaz (@WorkflowInterface) + DTOs
Signal External:   Solo el workflowId (y opcionalmente el nombre del signal)
Signal + Await:    workflowId + nombre del signal + DTOs del payload
```

### Reintentos y resiliencia

| Patrón | Reintentos | Qué pasa si el servicio remoto cae |
|--------|-----------|-------------------------------------|
| Remote Activity | Configurables vía `RetryOptions` | Temporal reintenta hasta que el worker vuelva o se agoten intentos |
| Child Workflow | El child tiene sus propios reintentos | El parent espera; el child retoma cuando el worker vuelve |
| Signal External | No aplica (fire & forget) | El signal se encola y se entrega cuando el workflow lo procese |
| Signal + Await | El await tiene timeout | Si no llega el signal, el timeout dispara lógica alternativa |

---

**Última actualización:** 2026-04-07
