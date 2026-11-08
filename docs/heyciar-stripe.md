# Stripe per heyciar.it

Wiki da copiare nel repo di heyciar.it (`SH-saas/progetto001-accessi`). Spiega come è impostato Stripe per heyciar e cosa deve fare il backend.
Fonte: repo `fatturazione-core` (servizio di fatturazione di Elia), decisioni #37, #39, #40. Aggiornata: 2026-11-08.

## 1. Il quadro in 6 righe

- Un solo soggetto fiscale: **STUDIO DIGITALE di Elia Gazzola**, P.IVA in **regime forfettario**. heyciar.it è una delle sue attività.
- Stripe è un'**organizzazione** con un account per attività. heyciar.it = account **`acct_1UZQkwDv9CxsNeAa`**.
- **Stripe incassa, ma non fa la fattura fiscale.** La fattura la emette il servizio `fatturazione-core` sul VPS, con numerazione unica per tutta la P.IVA.
- Il servizio riceve gli eventi Stripe di tutti gli account (webhook di organizzazione verso `https://gestione.gazzolaelia.it/webhooks/stripe`). Ogni pagamento di heyciar.it diventa una fattura con attività "heyciar.it". **Il backend di heyciar non deve fare niente per la fattura.**
- Le ricevute e le fatture Stripe che il cliente riceve per email **non sono la fattura fiscale**.
- **Niente IVA, mai** (vedi sezione 3).

## 2. Catalogo su Stripe

Prodotti e prezzi sono creati dallo script `scripts/stripe/heyciar-catalogo.mjs` del repo `fatturazione-core`, che legge il catalogo di questo repo (`catalogo/scripts/stripe-prodotti.mjs`). **Non crearli o modificarli a mano dalla dashboard.**

| Prodotto (id Stripe) | Prezzo (`lookup_key`) | Importo | Ricorrenza |
|---|---|---|---|
| `heyciar_persone_attive` | `persone_attive_mese` | 2,00 € | mese |
| `heyciar_piano_squadra` | `piano_squadra_mese` | 0,00 € | mese |
| `heyciar_piano_reparti` | `piano_reparti_mese` | 9,00 € | mese |
| `heyciar_piano_azienda` | `piano_azienda_mese` | 29,00 € | mese |
| `heyciar_sede_extra` | `sede_extra_mese` | 1,00 € | mese |
| `heyciar_api` | `api_mese` | 1,00 € | mese |
| `heyciar_branding` | `branding_mese` | 5,00 € | mese |
| `heyciar_sla` | `sla_7g_mese` / `sla_5g_mese` / `sla_3g_mese` / `sla_48h_mese` | 9 / 19 / 39 / 69 € | mese |
| `heyciar_ore_assistenza` | `ore_5_squadra` / `ore_10_squadra` | 400 / 800 € | una tantum |
| | `ore_5_reparti` / `ore_10_reparti` | 375 / 750 € | una tantum |
| | `ore_5_azienda` / `ore_10_azienda` | 350 / 700 € | una tantum |

Per tutti i prezzi valgono queste impostazioni:
- valuta `eur`;
- `tax_behavior: "inclusive"`: l'importo è quello finale pagato dal cliente;
- nei metadati del prezzo ci sono `quantita` e `business=heyciar.it`.

I prodotti hanno questi metadati:
- quelli del catalogo (`tipo`, `piano`, `quantita`, ...);
- `catalogo_chiave`;
- `business=heyciar.it`.

### Nel codice si usano i `lookup_key`, mai gli ID dei prezzi

```ts
const { data } = await stripe.prices.list({ lookup_keys: ['persone_attive_mese', 'piano_reparti_mese'], active: true });
```

Le variabili `STRIPE_PRICE_SEAT` e `STRIPE_PRICE_DOCUMENTS` del modello vecchio vanno tolte.

Se un importo cambia, lo script crea un prezzo nuovo, gli sposta lo stesso `lookup_key` e archivia quello vecchio. Così il codice non cambia. Gli abbonamenti esistenti restano al prezzo vecchio finché non vengono spostati esplicitamente.

### Per cambiare il listino

1. Modifica il catalogo in questo repo e fai il commit.
2. Elia lancia nel terminale del Mac la prova, che non cambia nulla:
   ```
   cd /Users/elia/offline/REPO-locali/fatturazione-core && node scripts/stripe/heyciar-catalogo.mjs
   ```
3. Se il risultato è giusto, Elia lancia la creazione:
   ```
   cd /Users/elia/offline/REPO-locali/fatturazione-core && node scripts/stripe/heyciar-catalogo.mjs crea
   ```

## 3. Regole fiscali (obbligatorie)

- **Mai `automatic_tax`** (Stripe Tax), né su Checkout né sugli abbonamenti o sulle fatture. **Mai `tax_rates`.** Il regime forfettario non applica l'IVA, e Stripe Tax costa per ogni transazione. Se una fattura Stripe contiene IVA, il servizio non la emette e avvisa Elia su Telegram.
- **Sul listino** scrivere "IVA non applicata, regime forfettario", non "IVA esclusa".
- **Marca da bollo** (2 € sopra 77,47 €): è compresa nel prezzo e non si addebita al cliente. Nel backend non c'è niente da fare.
- **Valuta solo `eur`.** Altre valute vengono rifiutate dal servizio.
- **Una invoice riguarda una sola attività**: non mischiare prodotti di altre attività.

## 4. Abbonamento

Un abbonamento mensile per azienda cliente, con questi item:

| Item | Quantità | Quando |
|---|---|---|
| `persone_attive_mese` | `max(3, persone attive)` | sempre (anche Squadra) |
| piano (`piano_squadra_mese` / `piano_reparti_mese` / `piano_azienda_mese`) | 1 | sempre |
| `sede_extra_mese` | sedi oltre le incluse (Squadra 2, Reparti 3) | solo se > 0, mai su Azienda |
| `api_mese` | persone fatturate | se attiva l'opzione API |
| `branding_mese` | 1 | solo Reparti e Azienda |
| un solo `sla_*_mese` | 1 | se scelto |

Il piano Free non ha abbonamento.

Impostazioni da usare sempre:
- **Mensile, senza prova gratuita e senza durata minima.**
- **Variazioni di quantità** (persone, sedi): `proration_behavior: "none"`. La variazione vale dal periodo successivo, come scritto nei Termini.
- **Disdetta:** `cancel_at_period_end: true`, mai la cancellazione immediata.
- **Mai `automatic_tax`** (vedi sezione 3).
- **Tetti degli SLA a 3 giorni e 48 ore** ("disponibilità limitata"): li controlla il backend prima di vendere quei livelli, perché Stripe non li gestisce.

Esempio:

```ts
await stripe.subscriptions.create({
  customer,
  items: [
    { price: prezzo['persone_attive_mese'], quantity: Math.max(3, personeAttive) },
    { price: prezzo['piano_reparti_mese'], quantity: 1 },
  ],
  proration_behavior: 'none',
  payment_behavior: 'default_incomplete',
});
```

Per un abbonamento Squadra con 3 persone il cliente paga 6 €/mese, e quella fattura il servizio la fa. Se un'invoice è a 0 € (per esempio dopo uno sconto), il servizio non fa la fattura.

## 5. Pacchetti di ore (una tantum)

Sono un servizio digitale e si fatturano sempre (decisione #41):

- **Primo acquisto insieme al canone:** il pacchetto va nella **prima invoice dell'abbonamento**. Con Checkout in modalità `subscription` basta mettere il prezzo `ore_*` tra i `line_items`, accanto ai prezzi mensili: Stripe lo addebita una volta sola, nella prima invoice. Ne nasce una sola fattura con canone e ore.
- **Acquisti successivi:** sono sempre **a parte**, con Checkout in modalità `payment`:
  - `line_items: [{ price: prezzo['ore_5_reparti'], quantity: 1 }]`;
  - `customer`: il Customer già esistente dell'azienda, così la fattura riporta ragione sociale, indirizzo e P.IVA salvati;
  - `payment_intent_data.description`: per esempio "heyciar – 5 ore di assistenza telefonica (Hey Reparti)". **Diventa la riga della fattura**, quindi va scritta in italiano e in modo chiaro;
  - **niente `invoice_creation`**, che non serve e su Stripe costa.
  Ne nasce una fattura separata.
- Se il cliente non ha ancora un Customer, usare `customer_creation: 'always'`, `billing_address_collection: 'required'` e `tax_id_collection: { enabled: true }`.

Dalla versione 0.1.4 del servizio, per i pagamenti senza invoice ragione sociale, indirizzo e P.IVA vengono presi dal Customer Stripe.

## 6. Dati del cliente (servono per la fattura)

Sul Customer Stripe:
- **`name`**: la ragione sociale;
- **`email`**;
- **`address`**: via, CAP, città, provincia (`state`, per esempio `MI`), paese `IT`;
- **tax id**:
  - `eu_vat` con la P.IVA, per esempio `IT01234567890` (il servizio toglie `IT`);
  - `it_cf` per il codice fiscale, se serve.

In Checkout: `billing_address_collection: 'required'` e `tax_id_collection: { enabled: true }`. Questi si possono usare anche senza Stripe Tax.

Il codice destinatario SDI e la PEC sono ancora da definire: arriveranno con la Fase 2 della fatturazione elettronica.

## 7. Chiavi e webhook del backend heyciar

- Il backend di heyciar usa una **sua chiave ristretta sull'account heyciar.it**, non quella di organizzazione del servizio di fatturazione. Permessi minimi:
  - Checkout Sessions, Customers, Subscriptions, Invoices, Invoice Items, Customer Portal: scrittura;
  - Products e Prices: lettura.
- Il backend riceve i suoi eventi da una **sua destinazione webhook sull'account heyciar.it**, verso il proprio backend, con chiave di firma propria. Eventi utili: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Non toccare** la destinazione di organizzazione verso `gestione.gazzolaelia.it`: è del servizio di fatturazione.
- Per lo sviluppo si usa una sandbox Stripe (chiavi test). Il servizio di fatturazione ignora gli eventi di test.

## 8. Cosa non fare

- Non attivare Stripe Tax o `automatic_tax`, e non aggiungere `tax_rates`.
- Non creare o modificare prodotti e prezzi dalla dashboard o dal backend: si fa con lo script (sezione 2).
- Non usare gli ID dei prezzi in configurazione: si usano i `lookup_key`.
- Non annullare o eliminare fatture pensando di correggere la fattura fiscale: le correzioni le fa Elia con una nota di credito. Rimborsi e contestazioni vengono segnalati automaticamente a Elia.
- Non mettere nella stessa invoice prodotti di altre attività.
