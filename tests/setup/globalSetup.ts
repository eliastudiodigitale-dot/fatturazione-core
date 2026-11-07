// Postgres di PROVA in Docker sul Mac (mai il VPS). Ricrea da zero DB e ruoli a ogni esecuzione,
// applica le migrazioni del repo nello stesso modo previsto in produzione (001 owner, 002 superutente, 003 owner).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CONTAINER, PORTA } from './env.js';

function sh(args: string[], input?: string) {
  return execFileSync('docker', args, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}
function psql(utente: string, db: string, sql: string, vars: string[] = []) {
  return sh(['exec', '-i', CONTAINER, 'psql', '-q', '-U', utente, '-d', db, '-v', 'ON_ERROR_STOP=1', ...vars.flatMap((v) => ['-v', v])], sql);
}

export default function setup() {
  const esiste = sh(['ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Status}}']).trim();
  if (!esiste) sh(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=test', '-p', `127.0.0.1:${PORTA}:5432`, 'postgres:16']);
  else if (!esiste.startsWith('Up')) sh(['start', CONTAINER]);
  for (let i = 0; ; i++) {
    try {
      sh(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']);
      psql('postgres', 'postgres', 'SELECT 1;');
      break;
    } catch {
      if (i > 60) throw new Error('Postgres di prova non pronto');
      execFileSync('sleep', ['0.5']);
    }
  }
  psql(
    'postgres',
    'postgres',
    `DROP DATABASE IF EXISTS fatturazione WITH (FORCE);
     DROP DATABASE IF EXISTS fatturazione_prova WITH (FORCE);
     DROP ROLE IF EXISTS fatturazione_app;
     DROP ROLE IF EXISTS fatturazione;
     CREATE ROLE fatturazione LOGIN PASSWORD 'owner_test';
     CREATE DATABASE fatturazione OWNER fatturazione;`,
  );
  const mig = (f: string) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8');
  psql('fatturazione', 'fatturazione', mig('001_schema.sql'));
  psql('postgres', 'fatturazione', mig('002_permessi.sql'), ['pw=app_test']);
  psql('fatturazione', 'fatturazione', mig('003_lettura_contatori.sql'));
  // 004 corregge l'ordine numero/data; con SOLO_001_002=1 si verifica il comportamento attuale del VPS.
  if (process.env.SOLO_001_002 !== '1') psql('fatturazione', 'fatturazione', mig('004_data_riserva_ordinata.sql'));
}
