# Accessi, utenti e agenti da creare

Stato: PROPOSTE, nessuna creata. Toccano autenticazione e VPS: decide ed esegue Elia.
Principio comune: un'identità per scopo, minimo privilegio, nessun segreto nel repo (solo nomi), revocabile da sola.

## VPS (sistema operativo)
1. **Utente `claude-agent`** senza sudo, login solo con chiave SSH dedicata (passphrase), shell normale.
   - Cartella unica di lavoro: `/srv/fatturazione-core` (clone del repo), proprietario `claude-agent`, `chmod 750`; nessun accesso al resto (`/home/*`, `/etc`, volumi k3s).
   - Lettura e scrittura solo lì. Nessun accesso al socket containerd né a `/etc/rancher/k3s/k3s.yaml`.
   - [DA DECIDERE] se serve davvero un accesso SSH o basta il ServiceAccount k8s sotto.

## Kubernetes (k3s, namespace `platform`)
2. **ServiceAccount `claude-lettore`** + Role in sola lettura: `get/list/watch` su pods, pods/log, deployments, jobs, cronjobs, events, configmaps. **Niente `secrets`**. Kubeconfig dedicato con token a scadenza.
3. **ServiceAccount `fatturazione-deploy`** (scrittura limitata): `patch/update` solo su `deployments/fatturazione-core`, `configmaps/fatturazione-core-config`, `configmaps/fatturazione-migrazioni`, `create` su `jobs` (migrazione). Lo usa Elia per il rilascio (resta la regola: rilascio solo manuale).
4. **ServiceAccount del pod `fatturazione-core`**: dedicato, `automountServiceAccountToken: false` (già nel manifest), nessun permesso API.

## Postgres (`services-postgres`, DB `fatturazione`)
5. **Ruolo `fatturazione_lettore`** (diagnostica, anche per agenti): `SELECT` su `documenti` senza la colonna `payload` (PII), su `storico`, `contatori`, `eventi_ricevuti` senza `raw`. Nessuna scrittura.
6. **Ruolo proprio per n8n** (punto aperto SPEC 12): n8n oggi usa il superutente `services` e può leggere `fatturazione`. Proposta: n8n parla solo con l'API (token `N8N_TOKEN`), il suo ruolo DB perde ogni accesso a `fatturazione`.

## Keycloak (Fase 3, namespace e URL [DA VERIFICARE])
7. **Realm `business`** con ruoli `owner` / `amministrazione` / `assistenza`, MFA obbligatoria (SPEC 10).
8. **Client `dashboard`** (confidential, Authorization Code + PKCE) per la dashboard Next.js.
9. **Client `fatturazione-core`** (bearer-only) per validare i token della dashboard lato API, al posto del `DASHBOARD_TOKEN` statico.
10. **Client service-account `n8n-fatturazione`** (client credentials) come alternativa futura al `N8N_TOKEN` statico.
11. **Client service-account `claude-admin`** per un agente che gestisce utenti/ruoli: solo `manage-users`/`view-users` del realm `business`, mai il realm `master`. [DA DECIDERE] se lo vuoi.

## Servizi esterni
12. **ClickUp**: utente/token dedicato "bot fatturazione" (`CLICKUP_TOKEN`), così la quota e l'audit sono separati da n8n e dalla dashboard. [DA VERIFICARE] limite richieste del workspace.
13. **Stripe**: chiave ristretta in sola lettura (`STRIPE_API_KEY`) con permessi su invoices, invoice payments, charges, payment intents; webhook endpoint con eventi `invoice.paid` e `payment_intent.succeeded`.
14. **GoCardless**: token di accesso in sola lettura (`GC_API_TOKEN`) e webhook endpoint dedicato (`GC_WEBHOOK_SECRET`).
15. **Notifiche anomalie** (punto aperto): bot Telegram dedicato oppure casella SMTP dedicata. Oggi le anomalie vanno solo nei log con tag `ANOMALIA`.
16. **Registry immagini** (`REGISTRY_DA_DEFINIRE` in k8s/app.yaml): utente di push per Elia e credenziale di pull in sola lettura per il cluster.
