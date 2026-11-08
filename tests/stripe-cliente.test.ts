import { describe, expect, it } from 'vitest';
import { clienteDaPagamento } from '../src/stripe.js';

const pagamento = {
  customer: 'cus_1',
  billing_details: { name: 'Mario Rossi', email: 'mario@carta.it', address: { line1: 'Via Carta 1', postal_code: '00100', city: 'Roma', state: 'RM', country: 'IT' } },
};

describe('cliente di un pagamento senza invoice (pacchetti ore heyciar)', () => {
  it('prende ragione sociale, indirizzo e P.IVA dal Customer', () => {
    const c = clienteDaPagamento(pagamento, {
      id: 'cus_1', name: 'Rossi SRL', email: 'amministrazione@rossi.it',
      address: { line1: 'Via Azienda 2', postal_code: '20100', city: 'Milano', state: 'MI', country: 'IT' },
      tax_ids: { data: [{ type: 'eu_vat', value: 'IT01234567890' }, { type: 'it_cf', value: 'RSSMRA80A01H501U' }] },
    });
    expect(c).toEqual({
      nome: 'Rossi SRL', email: 'amministrazione@rossi.it',
      indirizzo: { via: 'Via Azienda 2', cap: '20100', citta: 'Milano', provincia: 'MI', paese: 'IT' },
      partita_iva: '01234567890', codice_fiscale: 'RSSMRA80A01H501U', stripe_customer: 'cus_1',
    });
  });

  it('senza Customer usa i dati del pagamento, senza P.IVA', () => {
    const c = clienteDaPagamento({ ...pagamento, customer: null });
    expect(c.nome).toBe('Mario Rossi');
    expect(c.indirizzo?.citta).toBe('Roma');
    expect(c.partita_iva).toBeUndefined();
    expect(c.stripe_customer).toBeUndefined();
  });

  it('Customer eliminato o senza campi: ripiega sul pagamento', () => {
    expect(clienteDaPagamento(pagamento, { id: 'cus_1', deleted: true }).nome).toBe('Mario Rossi');
    const c = clienteDaPagamento(pagamento, { id: 'cus_1', name: null, address: null, tax_ids: { data: [] } });
    expect(c.nome).toBe('Mario Rossi');
    expect(c.indirizzo?.via).toBe('Via Carta 1');
    expect(c.partita_iva).toBeUndefined();
  });
});
