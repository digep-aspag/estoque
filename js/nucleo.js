/* ==========================================================================
   NÚCLEO DE CÁLCULO DO ESTOQUE — funções puras (sem Firebase, sem DOM)
   --------------------------------------------------------------------------
   Método de valoração: CUSTO MÉDIO PONDERADO MÓVEL (CMP)
   Base: Lei nº 4.320/1964, art. 106, III ("os bens de almoxarifado pelo
   preço médio ponderado das compras") e MCASP (STN), Parte II.

   Convenções:
   - Valores monetários são guardados em CENTAVOS INTEIROS (valorTotalCent),
     eliminando erros de ponto flutuante na soma do estoque.
   - O custo médio é DERIVADO: valorTotalCent / quantidade.
   - Quantidades admitem até 3 casas decimais (kg, litros, metros).
   - Na saída que zera o saldo, o valor baixado é o saldo financeiro inteiro,
     absorvendo o resíduo de arredondamento (o estoque nunca fica com
     "centavos fantasmas").
   ========================================================================== */

export const CASAS_QTD = 3;

export function arredQtd(q) {
  const f = 10 ** CASAS_QTD;
  return Math.round((Number(q) + Number.EPSILON) * f) / f;
}

/** Converte texto em formato brasileiro ("1.234,56", "12,5", "10") em número. */
export function lerNumeroBR(txt) {
  if (typeof txt === 'number') return Number.isFinite(txt) ? txt : NaN;
  if (txt == null) return NaN;
  let s = String(txt).trim().replace(/\s|R\$/g, '');
  if (s === '') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.234" = mil
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function reaisParaCent(reais) {
  return Math.round((Number(reais) + Number.EPSILON) * 100);
}

/** Custo médio unitário em reais (até 4 casas). */
export function custoMedio(estado) {
  if (!estado || estado.quantidade <= 0) return 0;
  return Math.round((estado.valorTotalCent / estado.quantidade / 100) * 10000) / 10000;
}

function validarQtd(qtd) {
  const q = arredQtd(qtd);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Informe uma quantidade maior que zero.');
  return q;
}

/**
 * ENTRADA (compra, doação, devolução ao almoxarifado).
 * novoTotal = totalAnterior + qtd × valorUnit ; novo CMP = novoTotal / novaQtd
 */
export function aplicarEntrada(estado, qtd, valorUnitReais) {
  const q = validarQtd(qtd);
  const vu = Number(valorUnitReais);
  if (!Number.isFinite(vu) || vu < 0) throw new Error('Informe um valor unitário válido (zero ou maior).');
  const valorMovCent = Math.round(q * vu * 100);
  const novo = {
    quantidade: arredQtd(estado.quantidade + q),
    valorTotalCent: estado.valorTotalCent + valorMovCent,
  };
  return { novo, quantidade: q, valorUnit: vu, valorMovCent, custoMedio: custoMedio(novo) };
}

/**
 * SAÍDA / RETIRADA — baixa pelo custo médio vigente.
 * valorSaída = round(qtd × totalAnterior / qtdAnterior); se zerar, baixa o total.
 */
export function aplicarSaida(estado, qtd) {
  const q = validarQtd(qtd);
  if (q > estado.quantidade + 1e-9) {
    throw new Error(`Saldo insuficiente: disponível ${fmtQtd(estado.quantidade)}, solicitado ${fmtQtd(q)}.`);
  }
  const zera = arredQtd(estado.quantidade - q) === 0;
  const valorMovCent = zera
    ? estado.valorTotalCent
    : Math.round((q * estado.valorTotalCent) / estado.quantidade);
  const novo = {
    quantidade: zera ? 0 : arredQtd(estado.quantidade - q),
    valorTotalCent: estado.valorTotalCent - valorMovCent,
  };
  return {
    novo, quantidade: q, valorMovCent,
    valorUnit: q ? valorMovCent / q / 100 : 0,
    custoMedio: custoMedio(novo),
  };
}

/**
 * AJUSTE DE INVENTÁRIO — iguala o saldo do sistema à contagem física.
 * Sobra → entrada pelo CMP vigente (ou valor informado, se o saldo estava zerado).
 * Falta → saída pelo CMP vigente.
 */
export function aplicarAjuste(estado, qtdContada, valorUnitSeZerado = 0) {
  const c = arredQtd(qtdContada);
  if (!Number.isFinite(c) || c < 0) throw new Error('Quantidade contada inválida.');
  const dif = arredQtd(c - estado.quantidade);
  if (dif === 0) return null;
  if (dif > 0) {
    const vu = estado.quantidade > 0 ? estado.valorTotalCent / estado.quantidade / 100 : Number(valorUnitSeZerado) || 0;
    return { tipo: 'AJUSTE_POS', ...aplicarEntrada(estado, dif, vu) };
  }
  return { tipo: 'AJUSTE_NEG', ...aplicarSaida(estado, -dif) };
}

/**
 * CURVA ABC (Pareto) por valor imobilizado.
 * A: até 80% do valor acumulado · B: até 95% · C: restante.
 */
export function curvaABC(produtos) {
  const lista = produtos.filter(p => p.valorTotalCent > 0)
    .sort((a, b) => b.valorTotalCent - a.valorTotalCent);
  const total = lista.reduce((s, p) => s + p.valorTotalCent, 0);
  const mapa = new Map();
  let acum = 0;
  for (const p of lista) {
    const antes = acum / total;               // classe pela posição de início
    acum += p.valorTotalCent;
    mapa.set(p.id, antes < 0.80 ? 'A' : antes < 0.95 ? 'B' : 'C');
  }
  return mapa; // produtos sem valor ficam sem classe
}

/** Totais consolidados do estoque. */
export function consolidar(produtos) {
  let valorCent = 0, abaixoMin = 0, zerados = 0, ativos = 0;
  for (const p of produtos) {
    if (p.ativo === false) continue;
    ativos++;
    valorCent += p.valorTotalCent || 0;
    if ((p.quantidade || 0) <= 0) zerados++;
    else if (p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo) abaixoMin++;
  }
  return { ativos, valorCent, abaixoMin, zerados };
}

/** Gera o ID do documento a partir do código (garante unicidade no Firestore). */
export function idDoCodigo(codigo) {
  const id = String(codigo || '').trim().toUpperCase().replace(/[\/\\#?\[\]\s]+/g, '-');
  if (!id || id === '.' || id === '..') throw new Error('Código do produto inválido.');
  if (id.length > 60) throw new Error('Código do produto muito longo (máx. 60 caracteres).');
  return id;
}

/* ---------- Formatação pt-BR ---------- */
const fBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fBRL4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fQtd = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: CASAS_QTD });
export const fmtCent = c => fBRL.format((c || 0) / 100);
export const fmtReais = r => fBRL.format(r || 0);
export const fmtUnit = r => fBRL4.format(r || 0);
export const fmtQtd = q => fQtd.format(q || 0);

/* ---------- CSV (padrão Excel pt-BR: ";" e BOM UTF-8) ---------- */
export function paraCSV(linhas) {
  const cel = v => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n');
}

export function lerCSV(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split(/\r?\n/)[0].match(/;/g) || []).length >= (t.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let lin = [], cel = '', aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { cel += '"'; i++; }
      else if (ch === '"') aspas = false;
      else cel += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { lin.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      lin.push(cel); cel = '';
      if (lin.some(x => x.trim() !== '')) linhas.push(lin);
      lin = [];
    } else cel += ch;
  }
  lin.push(cel); if (lin.some(x => x.trim() !== '')) linhas.push(lin);
  return linhas;
}

/** Normaliza texto para busca (sem acento, minúsculo). */
export const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
