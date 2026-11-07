import type { Tipo } from './config.js';

export type Stato = 'riservato' | 'creato' | 'inviato_sdi' | 'consegnato' | 'annullato';

const TRANSIZIONI: Record<Stato, readonly Stato[]> = {
  riservato: ['creato', 'annullato'],
  creato: ['inviato_sdi', 'annullato'],
  inviato_sdi: ['consegnato'],
  consegnato: [],
  annullato: [],
};

export function transizioneValida(tipo: Tipo, da: Stato, a: Stato): boolean {
  // Le proforme non vanno allo SDI: si fermano a 'creato'.
  if (tipo === 'proforma' && (a === 'inviato_sdi' || a === 'consegnato')) return false;
  // Le fatture non si annullano mai: si corregge con nota di credito (decisione #9).
  if (tipo === 'fattura' && a === 'annullato') return false;
  return TRANSIZIONI[da].includes(a);
}
