# Temporal-Only Architecture: Análisis de Riesgos y Trade-offs

## 📐 Visión General

Este documento analiza los riesgos de usar **Temporal como único mecanismo de 
comunicación** entre módulos, reemplazando Kafka (async) y Feign (sync).

Los archivos de diseño en esta carpeta (`docs/prototype/system/`) reflejan cómo 
se vería la arquitectura `test-eva` bajo este enfoque.

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

**Temporal (prototipo):**
```
products.ProductCreatedWorkflow DEBE listar explícitamente:
   ├── step: InitializeStock → target: inventory
   └── step: SyncProductReadModel → target: orders
   └── [futuro módulo X] → HAY QUE MODIFICAR el workflow del productor
```

**Impacto:** Agregar un nuevo consumidor requiere modificar el módulo productor.
Viola Open/Closed Principle. En un sistema con 15+ módulos, esto se vuelve 
inmantenible — cada módulo productor acumula conocimiento de todos sus 
consumidores.

**Severidad:** 🔴 Alta — es el riesgo estructural más significativo.

---

### R2. Pérdida de comunicación asíncrona real (fire-and-forget)

**Kafka:** El productor publica y continúa. Los consumidores procesan a su ritmo.
Si notifications tarda 30s en enviar un email, orders no se entera ni se bloquea.

**Temporal:** Aunque una activity se marque como `type: async` en el workflow, el
**workflow como instancia sigue vivo** hasta que todos los pasos terminen. Temporal
trackea el estado de cada step. Si NotifyOrderPlaced falla 3 veces, el workflow
completo queda en estado "running" indefinidamente.

**Impacto:** Un módulo no-crítico (notifications) puede mantener workflows del
módulo crítico (orders) en estado abierto, consumiendo recursos del Temporal 
server y complicando el monitoreo.

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

Con Temporal, cada módulo necesita registrar sus Activities en workers. El 
esquema de task queues (`LIGHT_TASK_QUEUE`, `HEAVY_TASK_QUEUE`) es global.
Si inventory registra `ReserveStock` en `LIGHT_TASK_QUEUE` y payments registra 
`ProcessOrderPayment` en `HEAVY_TASK_QUEUE`, necesitas:

- Worker pool para LIGHT con las activities de inventory, orders, 
  notifications, products
- Worker pool para HEAVY con las activities de payments

Escalar selectivamente (ej: más capacidad solo para pagos) requiere configurar
task queues separadas por módulo, multiplicando la complejidad de deployment.

**Severidad:** 🟡 Media — manejable, pero crece linealmente con módulos.

---

### R5. Read Models sin stream de eventos

Con Kafka, un Read Model puede re-consumir desde el offset 0 para reconstruir
su proyección completa (replay). Esto es crítico cuando:
- Se agrega un campo nuevo al ReadModel
- Se corrompe la tabla `rm_*`
- Se despliega un nuevo módulo consumidor

Con Temporal, no hay log de eventos persistente. Si la tabla `rm_orders_products`
se corrompe, no hay forma de "reproducir" los eventos pasados — habría que hacer
un dump/import manual desde la base de datos de products.

**Severidad:** 🟡 Media — impacta disaster recovery y evolución del esquema.

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
| `saga:` en domain.yaml | Concepto nuevo | ❌ No |
| `syncedBy.activity` en readModels | Reemplaza `syncedBy.event` | ❌ No |

Implementar esto requiere nuevos generadores, templates, y validadores.
Estimación aproximada: es equivalente a la feature completa de Kafka + Feign 
que ya existe.

**Severidad:** 🟡 Media — alto esfuerzo de desarrollo en eva4j.

---

## 🟢 Riesgos Bajos (Ventajas del enfoque)

### V1. Saga nativa con compensación

El flujo `CreateOrder → ReserveStock → ProcessPayment → ConfirmOrder` es
**sustancialmente mejor** con Temporal. La saga tiene compensación automática,
timeouts durables, y visibilidad del estado en el Temporal UI.

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

## 📊 Matriz Comparativa

| Criterio | Kafka (actual) | Temporal-only (prototipo) |
|---|---|---|
| Acoplamiento productor→consumidor | ✅ Nulo | ❌ Explícito |
| Agregar nuevo consumidor | ✅ Solo en consumidor | ❌ Modificar productor |
| Fan-out 1→N | ✅ Nativo (topics) | ⚠️ Manual (N steps) |
| Saga con compensación | ❌ Manual | ✅ Nativo |
| Replay de eventos | ✅ Desde offset 0 | ❌ No disponible |
| Observabilidad de flujos | ⚠️ Tracing externo | ✅ Temporal UI |
| SPOF | ⚠️ Broker (mitigable) | 🔴 Temporal Server |
| Servicios externos (HTTP) | ✅ Feign/ports[] | ⚠️ Híbrido obligatorio |
| Complejidad operativa | ⚠️ Kafka + Zookeeper/KRaft | ⚠️ Temporal Server + Workers |
| Soporte en eva4j | ✅ Completo | ❌ No existe |
| Escalabilidad selectiva | ✅ Consumer groups | ⚠️ Task queues |
| Event sourcing futuro | ✅ Natural | ❌ No aplica |

---

## 🎯 Recomendación

### Enfoque óptimo: **Kafka + Temporal complementarios**

```
┌─────────────────────────────────────────────────────────┐
│                    Comunicación                          │
├────────────────┬────────────────┬────────────────────────┤
│   Kafka        │   Temporal     │   Feign (HTTP)         │
│                │                │                        │
│ • Eventos de   │ • Saga de      │ • Servicios externos   │
│   dominio      │   orden        │   (payment gateway)    │
│ • Read models  │ • Orquestación │                        │
│ • Fan-out 1→N  │   con compen-  │                        │
│ • Desacopla-   │   sación       │                        │
│   miento       │ • Long-running │                        │
│                │   processes    │                        │
└────────────────┴────────────────┴────────────────────────┘
```

En el diseño actual (`system/system.yaml`), el candidato natural para Temporal es:

```yaml
# El flujo de orden:
PlaceOrderWorkflow:
  1. ReserveStock        (Activity → inventory)    # hoy es ports[] sync
  2. WaitForPayment      (Signal/Activity)          # hoy es listeners[] async  
  3. ConfirmOrder        (local)
  4. Compensate on fail  (ReleaseStock)            # hoy no existe

# Todo lo demás sigue en Kafka:
ProductCreatedEvent → inventory, orders (fan-out, desacoplado)
CustomerCreatedEvent → orders, notifications (read models)
```

Este enfoque obtiene **lo mejor de ambos mundos** sin los riesgos R1-R3,
y es soportado por eva4j hoy (`eva add temporal-client` + `eva g temporal-flow`).
