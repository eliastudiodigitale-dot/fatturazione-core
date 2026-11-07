// Test 9 (SPEC 11): ripristino dump in DB di prova, modalità bloccata, riallineamento contatore, sblocco.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { riserva } from '../src/documenti.js';
import { Blocco, controlloContatori } from '../src/blocco.js';
import { ClickUpFinto, admin, poolApp, svuota } from './helpers.js';
import { CONTAINER, PORTA } from './setup/env.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const dex = (args: string[], input?: string) => execFileSync('docker', ['exec', '-i', CONTAINER, ...args], { input }).toString();

describe('ripristino', () => {
  it('9. dump -> restore in DB di prova, blocco finché il contatore non è riallineato', async () => {
    const anno = new Date().getFullYear();
    for (let i = 1; i <= 3; i++) await riserva(pool, { ref: `p${i}|fattura|unica`, tipo: 'fattura', fonte: 'clickup', business: null, payload: { cliente: { n: 1 }, righe: [] } });

    // backup come il CronJob (pg_dump -Fc + verifica pg_restore -l) e restore in un DB di prova
    dex(['sh', '-c', 'pg_dump -U fatturazione -Fc -f /tmp/f.dump fatturazione && pg_restore -l /tmp/f.dump > /dev/null']);
    dex(['psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE IF EXISTS fatturazione_prova WITH (FORCE)', '-c', 'CREATE DATABASE fatturazione_prova OWNER fatturazione']);
    dex(['pg_restore', '-U', 'postgres', '-d', 'fatturazione_prova', '--no-owner', '--role=fatturazione', '/tmp/f.dump']);
    dex(['psql', '-U', 'postgres', '-d', 'fatturazione_prova', '-c', 'GRANT CONNECT ON DATABASE fatturazione_prova TO fatturazione_app']);

    const prova = new pg.Pool({ host: '127.0.0.1', port: PORTA, database: 'fatturazione_prova', user: 'fatturazione_app', password: 'app_test', max: 2 });
    try {
      const n = await prova.query('SELECT count(*)::int AS n FROM documenti');
      expect(n.rows[0].n).toBe(3);

      // ClickUp ha numeri oltre il dump (riserve dell'ultima ora perse)
      const cu = new ClickUpFinto();
      for (const k of [1, 2, 3, 4, 5]) await cu.creaTask('lista-fatture', { nome: '', descrizione: '', campi: [{ id: 'campo-chiave', value: `fattura|${anno}|${k}` }] });

      const blocco = new Blocco(true); // si riparte con FORZA_BLOCCO
      blocco.esito(await controlloContatori(prova, { api: cu, listId: { fattura: 'lista-fatture', proforma: 'lista-proforme' } }));
      expect(blocco.bloccato).toBe(true);

      // senza FORZA_BLOCCO ma con contatore indietro: resta bloccato
      const b2 = new Blocco(false);
      const problemi = await controlloContatori(prova, { api: cu, listId: { fattura: 'lista-fatture', proforma: 'lista-proforme' } });
      b2.esito(problemi);
      expect(b2.bloccato).toBe(true);
      expect(problemi[0]).toContain('< massimo trovato 5');

      // riallineamento manuale come owner con lo script del repo
      const script = readFileSync(new URL('../scripts/riallinea-contatore.sql', import.meta.url), 'utf8');
      dex(['psql', '-U', 'fatturazione', '-d', 'fatturazione_prova', '-v', 'ON_ERROR_STOP=1', '-v', `anno=${anno}`, '-v', 'tipo=fattura', '-v', 'max=5'], script);
      // lo script non può far scendere il contatore
      dex(['psql', '-U', 'fatturazione', '-d', 'fatturazione_prova', '-v', 'ON_ERROR_STOP=1', '-v', `anno=${anno}`, '-v', 'tipo=fattura', '-v', 'max=2'], script);

      b2.esito(await controlloContatori(prova, { api: cu, listId: { fattura: 'lista-fatture', proforma: 'lista-proforme' } }));
      expect(b2.bloccato).toBe(false);
      const r = await riserva(prova, { ref: 'nuovo|fattura|unica', tipo: 'fattura', fonte: 'clickup', business: null, payload: { cliente: { n: 1 }, righe: [] } });
      expect(r.numero).toBe(6);
    } finally {
      await prova.end();
    }
  });
});
