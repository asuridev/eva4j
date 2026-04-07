# Temporal-Only Architecture: Análisis de Riesgos y Trade-offs

## 📐 Visión General

Este documento analiza los riesgos de usar **Temporal como único mecanismo de 
comunicación** entre módulos, reemplazando Kafka (async) y Feign (sync).

Los archivos de diseño en esta carpeta (`docs/prototype/system/`) reflejan cómo 
se vería la arquitectura `test-eva` bajo este enfoque.

**Actualización (v2):** Se eliminaron Read Models. Los datos cross-module se 
obtienen on-demand via Remote Activities de lectura (`GetCustomerById`, 
`GetProductsByIds`). Se eliminaron 4 workflows que solo sincronizaban datos 
(`ProductUpdated/Deactivated`, `CustomerCreated/Updated`). Esto reduce 
significativamente el acoplamiento productor→consumidor (R1).

---

## 🔴 Riesgos Altos

### R1. Acoplamiento del productor a sus consumidores

**Kafka (actual):**
```
products publica ProductCreatedEvent → no sabe quién consume
   ├── inventory (se suscribe solo)
   └── orders (se suscribe solo)
   └── [futuro módulo X] (se suscribe sin tocar products)
```

**Temporal (prototipo v2):**
```
products.ProductCreatedWorkflow lista explícitamente:
   └── step: InitializeStock → target: inventory
   (solo 1 consumer — efecto de negocio real, no sync de datos)

Pero: cualquier workflow puede invocar GetProductById/GetProductsByIds
sin que products lo sepa → desacoplamiento por lectura on-demand.
```

**Impacto (v2 — REDUCIDO):**
Con la eliminación de read models, products ya no necesita saber que orders 
consume sus datos. Solo mantiene `notifies: ProductCreatedWorkflow` porque 
InitializeStock es un **efecto de negocio real** (crear stock), no sincronización.

`customers` queda **completamente desacoplado** — sus Domain Events son internos 
y no notifican a nadie. Los workflows de orders obtienen datos del cliente via 
`GetCustomerById` (Remote Activity) on-demand.

**Severidad:** 🟡 Media (reducida de 🔴 Alta) — el acoplamiento solo existe 
para efectos de negocio reales (InitializeStock), no para sincronización de datos.

---

### R2. Pérdida de comunicación asíncrona real (fire-and-forget)

**Kafka:** El productor publica y continúa. Los consumidores procesan a su ritmo.
Si notifications tarda 30s en enviar un email, orders no se entera ni se bloquea.

**Temporal:** Aunque una activity se marque como `type: async` en el workflow, el
**workflow como instancia sigue vivo** hasta que todos los pasos terminen. Temporal
trackea el estado de cada step. Si NotifyOrderPlaced falla 3 veces, el workflow
completo queda en estado "running" indefinidamente.

**Mitigación:** Usar `Async.function()` para activities non-critical 
(notificaciones) y NOT registrar compensación en la saga. Si falla, el workflow 
no se bloquea — solo se pierde la notificación.

**Severidad:** 🔴 Alta — afecta resiliencia y operaciones.

---

### R3. Single Point of Failure: Temporal Server

**Kafka:** El broker tiene replicación nativa (particiones, ISR). Si un broker 
cae, otro toma el liderazgo de la partición. Los productores y consumidores 
tienen decenas de librerías y patrones maduros para manejar desconexiones.

**Temporal:** El Temporal Server (frontend + history + matching + worker services)
es el punto central. Si cae:
- Ningún workflow puede avanzar
- Ninguna activity puede ejecutarse
- La comunicación entre TODOS los módulos se detiene simultáneamente

Temporal sí soporta clusters multi-nodo, pero la complejidad operativa es mayor
que Kafka para este tipo de uso (Temporal no fue diseñado como message bus).

**Severidad:** 🔴 Alta — riesgo operativo en producción.

---

## 🟡 Riesgos Medios

### R4. Complejidad operativa: N workers por módulo

Con Kafka, cada módulo tiene un consumer group. Escalar = agregar instancias.

Con Temporal y module-prefixed queues, cada módulo tiene su propio set de queues:
```
{MODULE}_WORKFLOW_QUEUE, {MODULE}_LIGHT_TASK_QUEUE, {MODULE}_HEAVY_TASK_QUEUE
```

Esto permite **escalado selectivo** (ej: más workers para 
`PAYMENT_HEAVY_TASK_QUEUE`), pero multiplica la cantidad de workers en deployment.

**Severidad:** 🟡 Media — manejable con module-scoped queues.

---

### R5. Latencia on-demand vs Read Models locales

Sin read models, cada workflow que necesita datos cross-module hace una llamada
on-demand via Remote Activity:
- `PlaceOrderWorkflow` → `GetCustomerById` (~5ms) + `GetProductsByIds` (~10ms)
- `CancelOrderWorkflow` → `GetCustomerById` (~5ms)

Con read models, esta data ya estaba en la BD local del módulo (~1ms).

**Impacto:** ~10-15ms extra por workflow. Aceptable para volúmenes bajos/medios.
Para alto volumen, se pueden agregar **caches con TTL** en las Activities sin 
necesidad de read models persistentes.

**Severidad:** 🟡 Media — trade-off aceptable para la simplificación obtenida.

---

### R6. Servicios externos siguen necesitando HTTP

El módulo `payments` llama a un gateway externo de pagos 
(`https://api.payments.example.com`). Ese servicio:
- No corre workers Temporal
- No entiende Activities
- Solo expone HTTP

Resultado: `ports[]` (Feign) **no puede eliminarse** para integraciones externas.
Temporal solo reemplaza comunicación **interna** entre módulos propios.

En la práctica, esto crea un modelo híbrido: Temporal entre módulos internos + 
HTTP para servicios externos. La promesa de "un solo mecanismo" no se cumple.

**Severidad:** 🟡 Media — la arquitectura no es tan uniforme como parece.

---

### R7. Modelo de Datos del Diseño: Secciones Nuevas sin soporte

El prototipo introduce conceptos que eva4j no tiene:

| Concepto nuevo | Dónde aparece | Genera código? |
|---|---|---|
| `orchestration:` en system.yaml | Reemplaza `messaging:` | ❌ No |
| `workflows:` en system.yaml | Reemplaza `integrations:` | ❌ No |
| `activities:` en domain.yaml | Concepto nuevo | ❌ No |
| `notifies:` en events | Reemplaza `topic:` | ❌ No |
| `parallel:` en workflow steps | Indica `Async.function()` | ❌ No |

Implementar esto requiere nuevos generadores, templates, y validadores.

**Nota:** `saga:` y `readModels.syncedBy.activity` fueron eliminados en v2.

**Severidad:** 🟡 Media — alto esfuerzo de desarrollo en eva4j.

---

## 🟢 Riesgos Bajos (Ventajas del enfoque)

### V1. Saga nativa con compensación

El flujo `CreateOrder → GetCustomer → GetProducts ∥ ReserveStock → 
ProcessPayment → ConfirmOrder → NotifyOrderPlaced` es **sustancialmente mejor** 
con Temporal. La saga tiene compensación automática, timeouts durables, y 
visibilidad del estado en el Temporal UI.

Con Kafka, este mismo flujo requiere implementar manualmente:
- Correlation IDs
- Estado de la saga en base de datos
- Compensación manual con eventos de rollback
- Timeout checks con scheduled jobs

**Veredicto:** Para este patrón específico, Temporal es claramente superior.

---

### V2. Observabilidad centralizada

Cada workflow es visible en el Temporal UI con su historial completo: qué 
activities se ejecutaron, cuáles fallaron, tiempos de ejecución, payloads.

Con Kafka, rastrear un flujo cross-module requiere correlación de logs,
distributed tracing (Zipkin/Jaeger), y mucha disciplina en los correlation IDs.

---

### V3. Retry con backoff nativo

Temporal reintenta activities automáticamente con backoff exponencial configurable.
Con Kafka, los retrys se implementan con DLQ (Dead Letter Queue), retry topics,
o lógica manual en el consumer.

---

### V4. Simplicidad sin Read Models

Eliminar read models simplifica significativamente la arquitectura:
- No hay tablas `rm_*` que mantener sincronizadas
- No hay workflows/listeners de sincronización
- No hay riesgo de datos stale en proyecciones
- Menos acoplamiento productor→consumidor (customers y products no notifican 
  a nadie para sync)
- Cada módulo es responsable solo de sus datos; otros acceden on-demand

**Trade-off:** Latencia on-demand (~10ms vs ~1ms local). Mitigable con caches.

---

## 📊 Matriz Comparativa

| Criterio | Kafka + Read Models | Temporal-only (v2, sin RM) |
|---|---|---|
| Acoplamiento productor→consumidor | ✅ Nulo | 🟡 Solo para efectos de negocio |
| Agregar nuevo consumidor | ✅ Solo en consumidor | 🟡 Agregar Activity de lectura |
| Fan-out 1→N | ✅ Nativo (topics) | ⚠️ Manual (N steps en workflow) |
| Saga con compensación | ❌ Manual | ✅ Nativo |
| Replay de eventos | ✅ Desde offset 0 | ❌ No disponible |
| Observabilidad de flujos | ⚠️ Tracing externo | ✅ Temporal UI |
| SPOF | ⚠️ Broker (mitigable) | 🔴 Temporal Server |
| Servicios externos (HTTP) | ✅ Feign/ports[] | ⚠️ Híbrido obligatorio |
| Complejidad operativa | ⚠️ Kafka + Zookeeper/KRaft | ⚠️ Temporal Server + Workers |
| Soporte en eva4j | ✅ Completo | ❌ No existe |
| Escalabilidad selectiva | ✅ Consumer groups | ✅ Module-prefixed queues |
| Simplicidad del esquema | ⚠️ Tablas rm_* + sync | ✅ Sin proyecciones |
| Latencia cross-module | ✅ Local (~1ms) | 🟡 On-demand (~10ms) |
| Event sourcing futuro | ✅ Natural | ❌ No aplica |

---

## 🎯 Recomendación

### Para este e-commerce: **Temporal-only es viable**

Con la eliminación de read models, la arquitectura Temporal-only se simplifica 
considerablemente. Los riesgos principales se reducen:

```
R1 (acoplamiento):  🔴 → 🟡  (solo efectos de negocio, no sync de datos)
R5 (read models):   🟡 → ✅  (eliminado — reemplazado por latencia on-demand)
```

La arquitectura queda:

```
┌──────────────────────────────────────────────────────────────┐
│                    Comunicación                               │
├──────────────────────────────┬───────────────────────────────┤
│       Temporal               │   Feign (HTTP)                │
│                              │                               │
│ • Saga de orden              │ • Servicios externos          │
│   (PlaceOrder, CancelOrder)  │   (payment gateway)           │
│ • Efectos de negocio         │                               │
│   (ProductCreated→InitStock) │                               │
│ • Lectura on-demand          │                               │
│   (GetCustomer, GetProducts) │                               │
│ • Notificaciones             │                               │
│   (Async.function, no-block) │                               │
│ • Retry + compensación       │                               │
└──────────────────────────────┴───────────────────────────────┘
```

### Cuándo escalar a Kafka + Temporal complementarios

Si el sistema evoluciona a:
- **15+ módulos** con fan-out 1→N frecuente → Kafka para eventos de dominio
- **Alto volumen** donde ~10ms on-demand es inaceptable → Read Models + Kafka
- **Event sourcing** necesario → Kafka como log de eventos

Para un e-commerce de complejidad media-baja, Temporal-only cubre todos los 
casos con menos infraestructura y menos complejidad operativa.
