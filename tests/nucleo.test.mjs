// Testes do núcleo de cálculo. Execute: node tests/nucleo.test.mjs
import assert from 'node:assert/strict';
import * as N from '../js/nucleo.js';

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log('✔', nome); };

t('lerNumeroBR', () => {
  assert.equal(N.lerNumeroBR('1.234,56'), 1234.56);
  assert.equal(N.lerNumeroBR('12,5'), 12.5);
  assert.equal(N.lerNumeroBR('R$ 10'), 10);
  assert.equal(N.lerNumeroBR('1.000'), 1000);
  assert.equal(N.lerNumeroBR('0.25'), 0.25);
  assert.ok(Number.isNaN(N.lerNumeroBR('abc')));
  assert.ok(Number.isNaN(N.lerNumeroBR('')));
});

t('Entrada inicial e custo médio ponderado', () => {
  let e = { quantidade: 0, valorTotalCent: 0 };
  let r = N.aplicarEntrada(e, 100, 2.50);          // 100 × 2,50 = 250,00
  assert.deepEqual(r.novo, { quantidade: 100, valorTotalCent: 25000 });
  r = N.aplicarEntrada(r.novo, 50, 3.10);          // + 155,00 → 405,00 / 150
  assert.deepEqual(r.novo, { quantidade: 150, valorTotalCent: 40500 });
  assert.equal(r.custoMedio, 2.70);
});

t('Saída baixa pelo CMP e recalcula o total', () => {
  const e = { quantidade: 150, valorTotalCent: 40500 };
  const r = N.aplicarSaida(e, 40);                 // 40 × 2,70 = 108,00
  assert.equal(r.valorMovCent, 10800);
  assert.deepEqual(r.novo, { quantidade: 110, valorTotalCent: 29700 });
  assert.equal(r.custoMedio, 2.70);
});

t('Resíduo de arredondamento absorvido ao zerar', () => {
  let e = { quantidade: 3, valorTotalCent: 1000 };  // CMP 3,3333…
  let r = N.aplicarSaida(e, 1); assert.equal(r.valorMovCent, 333);
  r = N.aplicarSaida(r.novo, 1); assert.equal(r.valorMovCent, 334); // 667×1/2=333,5→334
  r = N.aplicarSaida(r.novo, 1); assert.equal(r.valorMovCent, 333);
  assert.deepEqual(r.novo, { quantidade: 0, valorTotalCent: 0 });
});

t('Saldo insuficiente e quantidade inválida', () => {
  const e = { quantidade: 5, valorTotalCent: 500 };
  assert.throws(() => N.aplicarSaida(e, 6), /Saldo insuficiente/);
  assert.throws(() => N.aplicarSaida(e, 0), /maior que zero/);
  assert.throws(() => N.aplicarEntrada(e, 1, -2), /valor unitário/);
});

t('Quantidades fracionadas (kg)', () => {
  const r = N.aplicarEntrada({ quantidade: 0.1, valorTotalCent: 10 }, 0.2, 1);
  assert.equal(r.novo.quantidade, 0.3);            // sem 0.30000000000000004
});

t('Ajuste de inventário (sobra e falta)', () => {
  const e = { quantidade: 10, valorTotalCent: 2000 };
  const s = N.aplicarAjuste(e, 12);
  assert.equal(s.tipo, 'AJUSTE_POS'); assert.deepEqual(s.novo, { quantidade: 12, valorTotalCent: 2400 });
  const f = N.aplicarAjuste(e, 7);
  assert.equal(f.tipo, 'AJUSTE_NEG'); assert.deepEqual(f.novo, { quantidade: 7, valorTotalCent: 1400 });
  assert.equal(N.aplicarAjuste(e, 10), null);
  const z = N.aplicarAjuste({ quantidade: 0, valorTotalCent: 0 }, 4, 1.5);
  assert.deepEqual(z.novo, { quantidade: 4, valorTotalCent: 600 });
});

t('Sequência longa mantém consistência (soma de baixas = entradas − saldo)', () => {
  let e = { quantidade: 0, valorTotalCent: 0 }, entr = 0, said = 0;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 5000; i++) {
    if (rnd() < 0.5 || e.quantidade < 1) {
      const r = N.aplicarEntrada(e, Math.ceil(rnd() * 20), Math.round(rnd() * 10000) / 100);
      entr += r.valorMovCent; e = r.novo;
    } else {
      const r = N.aplicarSaida(e, Math.max(1, Math.floor(rnd() * e.quantidade)));
      said += r.valorMovCent; e = r.novo;
    }
    assert.ok(e.valorTotalCent >= 0);
    assert.equal(entr - said, e.valorTotalCent);
  }
});

t('Curva ABC', () => {
  const m = N.curvaABC([
    { id: 'a', valorTotalCent: 7000 }, { id: 'b', valorTotalCent: 2000 },
    { id: 'c', valorTotalCent: 600 }, { id: 'd', valorTotalCent: 400 }, { id: 'z', valorTotalCent: 0 },
  ]);
  assert.equal(m.get('a'), 'A'); assert.equal(m.get('b'), 'A');
  assert.equal(m.get('c'), 'B'); assert.equal(m.get('d'), 'C'); assert.equal(m.get('z'), undefined);
});

t('ID a partir do código e CSV', () => {
  assert.equal(N.idDoCodigo(' mat/001 a '), 'MAT-001-A');
  assert.throws(() => N.idDoCodigo('  '));
  const csv = N.paraCSV([['a;b', 'x"y'], [1, 2]]);
  assert.deepEqual(N.lerCSV(csv), [['a;b', 'x"y'], ['1', '2']]);
});

console.log(`\n${ok} grupos de teste aprovados.`);
