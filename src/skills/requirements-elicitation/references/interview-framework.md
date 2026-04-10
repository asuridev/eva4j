# Interview Framework — Requirements Elicitation

Este documento contiene el banco de preguntas completo, organizadas por dimensión, con notas sobre cuándo usar cada una y ejemplos de respuestas que revelan entendimiento profundo vs. superficial.

---

## Dimensión 1 — Actores y Roles

El objetivo es descubrir *quién* interactúa con el sistema, con qué intenciones, y qué permisos o restricciones tienen.

### Preguntas de descubrimiento

**Básicas (siempre hacer):**
- ¿Quiénes son los usuarios de este sistema? ¿Hay diferentes tipos?
- ¿Alguien administra el sistema "desde adentro" (backoffice) además de los usuarios finales?
- ¿Hay usuarios que solo consultan vs. usuarios que crean o modifican información?

**De profundidad (cuando hay múltiples roles):**
- ¿Qué puede hacer cada tipo de usuario que los demás NO pueden?
- ¿Hay jerarquías? ¿Un manager puede ver/hacer cosas que un empleado no?
- ¿Los permisos se configuran por empresa/tenant o son fijos?
- ¿Hay acciones que requieren la participación de más de un rol para completarse?

**De borde:**
- ¿Puede un usuario tener múltiples roles? ¿Al mismo tiempo?
- ¿Hay usuarios "invitados" o acceso sin autenticación para alguna parte?
- ¿Hay actores no-humanos involucrados? (sistemas externos, cron jobs, webhooks)

### Señales de respuesta completa
✅ Hay al menos 2 actores identificados con nombres concretos (no "usuario genérico")  
✅ Sabes qué hace CADA actor en el sistema  
✅ Sabes las diferencias de permisos entre actors  

### Señales de que necesitas profundizar
⚠️ "Solo hay un tipo de usuario" — improbable en sistemas reales, pregunta por backoffice  
⚠️ "El admin puede hacer todo" — necesitas saber exactamente qué es "todo"  

---

## Dimensión 2 — Flujo Principal de Valor

El objetivo es entender el *momento de mayor valor* del sistema: la secuencia de pasos que le da sentido al producto.

### Preguntas de descubrimiento

**El flujo central:**
- ¿Cuál es la acción más importante que este sistema permite hacer? ¿Cuéntame cómo funciona paso a paso.
- Si una persona nueva llegara y quisiera usar la función principal del sistema, ¿qué haría?
- ¿Qué tiene que estar "listo" en el sistema antes de que ese flujo sea posible?

**Lo que viene antes y después:**
- ¿Cómo empieza el flujo? ¿Quién lo inicia?
- ¿Hay pasos que ocurren automáticamente (sin acción del usuario)?
- ¿Qué pasa inmediatamente después de que el flujo termina? ¿Qué se registra? ¿Quién se entera?
- ¿Hay algo que deba pasar "en background" después de la acción principal?

**Concurrencia y volumen:**
- ¿Múltiples usuarios pueden estar haciendo esto al mismo tiempo sobre el mismo recurso? (ej: dos personas comprando el último item en stock)
- ¿Cuántas veces aproximadamente se ejecuta este flujo por día? (afecta diseño de performance)

### Técnica narrativa: "El día en la vida"

Si el usuario responde de forma muy abstracta, pide: *"Cuéntame un caso concreto real que hayas tenido. Empezando desde el principio, ¿qué pasó?"*

Los casos concretos revelan excepciones y reglas implícitas que la descripción abstracta oculta.

### Señales de respuesta completa
✅ Puedes narrar el flujo en 5–10 pasos concretos  
✅ Sabes el actor que inicia cada paso  
✅ Sabes qué datos se necesitan en cada punto  
✅ Sabes si hay pasos automáticos vs. manuales  

---

## Dimensión 3 — Estados y Ciclos de Vida

El objetivo es descubrir el **modelo de estados** de las entidades clave. Esta dimensión es la más reveladora para DDD porque los estados definen el ciclo de vida del agregado.

### Preguntas de descubrimiento

**Identificar la entidad core:**
- ¿Cuál es la "cosa" principal que el sistema gestiona? (el pedido, la reserva, la solicitud, el ticket...)
- ¿Cómo llamarías a esa cosa en tu negocio?

**Descubrir los estados:**
- ¿En qué estados puede estar ese [objeto]? ¿Tiene estados diferentes en distintos momentos?
- ¿Cuándo está "en progreso"? ¿Cuándo está "terminado"? ¿Cuándo está "rechazado"?
- ¿Puede un [objeto] que está "terminado" volver a estar activo? ¿Bajo qué condición?
- ¿Hay estados que son permanentes (no se puede salir de ellos)?

**Descubrir las transiciones:**
- Para ir de [Estado A] a [Estado B], ¿qué tiene que pasar? ¿Quién lo hace?
- ¿Hay transiciones que son automáticas (pasa sola después de un tiempo o un evento)?
- ¿Hay transiciones que requieren aprobación de alguien?

**Estados de fallo:**
- ¿Qué pasa si algo falla a mitad del proceso? ¿El [objeto] queda en algún estado intermedio?
- ¿Se puede cancelar? ¿Hay cancelaciones automáticas (ej: si no se paga en X tiempo)?

### Plantilla de diagrama de estados (para construir durante la entrevista)

```
[Estado1] --(acción: quién)--> [Estado2]
[Estado2] --(acción: quién)--> [Estado3]
[Estado2] --(acción: quién / condición)--> [EstadoCancelado]
```

Construye esto mentalmente y valida con el usuario antes de sintetizar.

### Señales de respuesta completa
✅ Tiene al menos 3 estados identificados  
✅ Sabes quién desencadena cada transición  
✅ Sabes si hay estados terminales (irreversibles)  
✅ Sabes si hay tiempos involucrados (expiración, recordatorios)  

---

## Dimensión 4 — Reglas de Negocio e Invariantes

Esta es la dimensión más valiosa y la más difícil de extraer. Las reglas de negocio reales raramente aparecen en la descripción inicial — hay que excavar.

### Preguntas de descubrimiento

**Reglas de validación:**
- ¿Qué información es obligatoria para crear un [objeto]? ¿Hay campos que deben cumplir un formato?
- ¿Hay combinaciones de datos inválidas? (ej: no puede haber descuento del 100% en órdenes > $1000)

**Límites y cuotas:**
- ¿Hay límites de cantidad, stock, fondos, o cupos? ¿Qué pasa cuando se alcanza el límite?
- ¿Hay reglas de "máximo por usuario" o "máximo global"?

**Reglas de tiempo:**
- ¿Hay cosas que expiran? ¿Cuánto tiempo duran vigentes?
- ¿Hay recordatorios o notificaciones automáticas antes de que algo expire?
- ¿Hay horas hábiles o ventanas de tiempo para ciertas operaciones?

**Reglas de autorización:**
- ¿Hay acciones que solo ciertos roles pueden hacer bajo ciertas condiciones?
- ¿Hay aprobaciones? ¿Dobles niveles de aprobación?
- ¿Un usuario puede operar sobre recursos de otros usuarios? ¿Bajo qué condición?

**Reglas de integridad:**
- ¿Puede eliminarse un [objeto] si tiene [otros objetos] asociados?
- ¿Qué pasa con los [objetos relacionados] cuando eliminas o cancelas el [objeto principal]?

### La pregunta más reveladora

Cuando el usuario ya cubrió las reglas obvias, pregunta:
*"¿Cuál ha sido el litigio o problema de negocio más común que este sistema debería haber evitado? ¿Qué regla habría prevenido ese problema?"*

Los problemas reales revelan las reglas implícitas que nadie piensa en mencionar.

### Señales de respuesta completa
✅ Tienes al menos 5 reglas concretas (no "los campos son obligatorios" — eso es genérico)  
✅ Tienes al menos 1 regla que no es obvia (invariante de negocio específico del dominio)  
✅ Sabes qué pasa cuando se viola cada regla (error al usuario, log, reintento...)  

---

## Dimensión 5 — Casos de Borde e Integraciones

### Preguntas sobre fallos

- ¿Qué pasa si [sistema externo crítico] no responde? (ej: pasarela de pago, SMS, inventario)
- ¿Qué pasa si el usuario no completa el flujo? ¿Queda algo incompleto en el sistema?
- ¿Qué pasa si dos usuarios intentan hacer lo mismo al mismo tiempo sobre el mismo recurso?
- ¿Hay operaciones que deben ser "o todo o nada"? (ej: reservar stock Y registrar el pedido — si una falla, la otra debe revertirse)

### Preguntas sobre integraciones

- ¿Hay sistemas externos que este sistema llama? (APIs de pago, correo, SMS, mapas, CRM...)
- ¿Hay sistemas externos que llaman a este? (webhooks entrantes, integraciones)
- ¿Hay sistemas internos de la empresa que deben sincronizarse? (ERP, contabilidad, BI)
- ¿Hay proveedores externos con SLAs específicos o limitaciones de rate?

### Preguntas sobre observabilidad

- ¿Hay dashboards o reportes que el negocio necesita?
- ¿Necesitas auditoría de quién hizo qué y cuándo?
- ¿Hay notificaciones que deben enviarse? ¿A quién, cuándo, por qué canal?

### Señales de respuesta completa
✅ Sabes al menos el flujo de fallo del caso más crítico  
✅ Sabes todas las integraciones externas y su propósito  
✅ Sabes si hay notificaciones y cuándo/a quién  

---

## Técnicas de Entrevista Efectiva

### Técnica: Cinco "¿Por qué?"

Cuando una respuesta parece simple, aplica "¿por qué?" hasta descubrir la regla real:

> "Los precios no pueden ser negativos."  
> "¿Por qué? ¿Hay un caso donde un descuento podría llevar a precio negativo?"  
> "Bueno, sí, los descuentos están limitados al 90%..."  
> "¿Y quién puede asignar descuentos mayores al 50%?"  

Cada "¿por qué?" revela una regla nueva.

### Técnica: Casos extremos

"Qué pasa si..." seguido de un caso extremo o anormal:
- "¿Qué pasa si alguien intenta comprar 10,000 unidades de golpe?"
- "¿Qué pasa si el usuario canceló su cuenta pero tiene pedidos pendientes?"
- "¿Qué pasa si la misma dirección registra dos cuentas?"

### Técnica: Analogía de negocio

Si el usuario no sabe cómo responder, usa analogías del mismo dominio:
- "En Amazon, cuando compras el último artículo disponible, el stock cae a 0 y el producto se marca como agotado. ¿Algo similar ocurre aquí?"

Esto da al usuario un punto de partida para comparar y ajustar.

### Técnica: Pre-condición explícita

Para cada flujo, pregunta: "¿Qué tiene que ser verdad en el sistema ANTES de que esto sea posible?"  
Esto revela dependencias, pre-estados, y configuración necesaria que el usuario asume obvia.

---

## Reconocer Dominios Comunes y Sus Preguntas Específicas

### E-Commerce / Marketplace
- ¿Hay inventario real o es bajo demanda? ¿Por SKU o por variante?
- ¿Cómo funciona el pricing? ¿Precios fijos, variables, por nivel de cliente?
- ¿Hay carrito persistente? ¿Sesión anónima?
- ¿La empresa vende directamente o es un marketplace con múltiples vendedores?
- ¿Cómo es el flujo de fulfillment? ¿Quién gestiona el envío?

### Salud / Clínica
- ¿Hay citas con disponibilidad limitada? ¿Cómo se gestiona el horario del profesional?
- ¿Hay historia clínica? ¿Quién puede acceder a ella?
- ¿Hay prescripciones o autorizaciones que deben seguir flujos regulatorios?
- ¿Hay integración con seguros médicos o sistemas de salud nacionales?

### Logística / Transportes
- ¿El seguimiento es en tiempo real o por hitos?
- ¿Hay múltiples paradas o puntos de entrega?
- ¿Qué pasa si el destinatario no está? ¿Reintento automático o manual?
- ¿Hay zonas geográficas con reglas distintas?

### Fintech / Pagos
- ¿La plataforma mueve dinero real o es solo trazabilidad?
- ¿Hay wallets o saldos internos? ¿Cómo se fondean?
- ¿Hay regulación local que aplique? (PCI-DSS, normativa bancaria local)
- ¿Hay reversiones o chargebacks?

### B2B SaaS / Multi-tenant
- ¿Los clientes son empresas con múltiples usuarios?
- ¿Cada empresa tiene datos completamente aislados o hay datos compartidos?
- ¿Hay planes/tiers con funcionalidades distintas?
- ¿Hay un ciclo de onboarding de empresa antes de que los usuarios puedan operar?

### RR.HH. / Gestión Interna
- ¿Hay jerarquía organizacional que afecte permisos o flujos de aprobación?
- ¿Los flujos pasan por múltiples niveles de aprobación?
- ¿Hay integración con nómina u otros sistemas de HR?
- ¿Hay períodos de cierre (mensual, anual) que restrinjan operaciones?
