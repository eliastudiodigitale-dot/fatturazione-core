# Stack

Nel repo non c'è ancora codice né package.json. Quanto sotto viene da SPEC.md (fb69474).

- Servizio: TypeScript/Node con Fastify e `pg` — consigliato, **[DA CONFERMARE]** (SPEC sez. 12)
- Database: Postgres 16.11 (`services-postgres`, immagine `postgres:16`), DB `fatturazione`
- Runtime: k3s sul VPS, namespace `platform`
- Servizi esterni: ClickUp (copia documenti), Stripe (webhook `invoice.paid`, `payment_intent.succeeded`), GoCardless (webhook batch), n8n (`n8n.spaziocliente.it`), Keycloak (fase 3, [DA VERIFICARE] URL)
- Fase 2: provider SDI (Openapi o A-Cube, da confrontare)
- Dashboard futura: Next.js (citata come coerenza di stack)
