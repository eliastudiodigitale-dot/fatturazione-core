// Valori di PROVA (DB locale usa e getta): non sono segreti.
export const CONTAINER = 'fatturazione-test-pg';
export const PORTA = 55432;

export const ENV_TEST: Record<string, string> = {
  PG_HOST: '127.0.0.1',
  PG_PORT: String(PORTA),
  PG_DB: 'fatturazione',
  APP_PG_USER: 'fatturazione_app',
  APP_PG_PASS: 'app_test',
  PG_SSL: 'disable',
  N8N_TOKEN: 'n8n-token-di-prova-lungo-almeno-32-caratteri',
  DASHBOARD_TOKEN: 'dashboard-token-di-prova-lungo-almeno-32-car',
  OWNER_TOKEN: 'owner-token-di-prova-lungo-almeno-32-caratteri',
  PAGAMENTI_TIPO_DOCUMENTO: 'fattura',
  STRIPE_WEBHOOK_SECRET: 'whsec_prova',
  STRIPE_API_KEY: 'rk_test_prova',
  GC_WEBHOOK_SECRET: 'gc-segreto-di-prova',
  GC_API_TOKEN: 'gc-token-prova',
  GC_TRIGGER_ACTION: 'confirmed',
  CLICKUP_TOKEN: 'pk_prova',
  CLICKUP_LIST_ID_FATTURA: 'lista-fatture',
  CLICKUP_LIST_ID_PROFORMA: 'lista-proforme',
  CLICKUP_CAMPO_CHIAVE_ID: 'campo-chiave',
  CLICKUP_CAMPO_NUMERO_ID: 'campo-numero',
};
