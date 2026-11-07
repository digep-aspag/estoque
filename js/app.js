/* ==========================================================================
   CONTROLE DE ESTOQUE — IBRAM-DF
   Aplicação web estática (GitHub Pages) + Firebase Auth + Cloud Firestore
   ========================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, onSnapshot, runTransaction,
  setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig, INSTITUICAO, LOGIN, MAX_ITENS_POR_LANCAMENTO } from "./config.js";
import * as N from "./nucleo.js";

/* ---------------------------------------------------------------- Firebase */
const CONFIG_OK = firebaseConfig.apiKey && firebaseConfig.apiKey !== "COLE_AQUI";
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
auth.languageCode = "pt-BR";
const db = getFirestore(fbApp);
const colProd = collection(db, "produtos");
const colMov = collection(db, "movimentos");
const colUsu = collection(db, "usuarios");

/* ---------------------------------------------------------------- Estado */
const S = {
  user: null, email: "", perfil: null,
  produtos: [], porId: new Map(), abc: new Map(),
  recentes: [], doMes: [], movConsulta: [], usuarios: [],
  unsubs: [], vista: "painel",
  ordem: { campo: "codigo", dir: 1 },
  lanc: null, editando: null, invPendente: false,
};
const INV_KEY = "estoque-ibram-inventario-v1";

/* ---------------------------------------------------------------- Utilidades */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailNorm = e => String(e || "").trim().toLowerCase();
const tsDate = ts => (ts && typeof ts.toDate === "function") ? ts.toDate() : (ts instanceof Date ? ts : null);
const fmtData = ts => { const d = tsDate(ts); return d ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"; };
const fmtDia = ts => { const d = tsDate(ts); return d ? d.toLocaleDateString("pt-BR") : "—"; };
const hojeISO = () => new Date().toLocaleDateString("sv-SE");
const ROTULO_TIPO = { ENTRADA: "Entrada", SAIDA: "Retirada", AJUSTE_POS: "Ajuste (+)", AJUSTE_NEG: "Ajuste (−)", SALDO_INICIAL: "Saldo inicial", ESTORNO_POS: "Estorno (+)", ESTORNO_NEG: "Estorno (−)" };
const ROTULO_PAPEL = { admin: "Administrador", operador: "Operador", leitor: "Consulta" };
const ehEntrada = t => N.ehTipoEntrada(t);
const ehEstorno = t => String(t).startsWith("ESTORNO");
const podeEscrever = () => ["admin", "operador"].includes(S.perfil?.papel);
const ehAdmin = () => S.perfil?.papel === "admin";

function toast(msg, erro = false) {
  const el = document.createElement("div");
  el.className = "toast" + (erro ? " erro" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), erro ? 7000 : 4000);
}

function msgErro(e) {
  const c = e?.code || "";
  const m = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/email-already-in-use": "Este e-mail já possui senha cadastrada. Use \"Entrar\" ou \"Esqueci a senha\".",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/popup-closed-by-user": "Janela de login fechada antes da conclusão.",
    "auth/popup-blocked": "O navegador bloqueou a janela de login. Permita pop-ups para este site.",
    "auth/unauthorized-domain": "Domínio não autorizado no Firebase (Authentication → Settings → Authorized domains).",
    "auth/operation-not-allowed": "Método de login não habilitado no Firebase.",
    "auth/network-request-failed": "Falha de rede. Verifique a conexão.",
    "permission-denied": "Permissão negada: seu perfil não permite esta operação.",
    "unavailable": "Banco de dados indisponível. Verifique a conexão.",
    "failed-precondition": "Operação não permitida no estado atual.",
  }[c];
  return m || e?.message || String(e);
}

function confirmar(titulo, html, textoSim = "Confirmar") {
  const dlg = $("#dlg-confirma");
  $("#dc-titulo").textContent = titulo;
  $("#dc-texto").innerHTML = html;
  $("#dc-sim").textContent = textoSim;
  dlg.showModal();
  return new Promise(res => {
    const fim = v => { dlg.close(); $("#dc-sim").onclick = $("#dc-nao").onclick = null; dlg.onclose = null; res(v); };
    $("#dc-sim").onclick = () => fim(true);
    $("#dc-nao").onclick = () => fim(false);
    dlg.onclose = () => res(false);
  });
}

function baixar(nome, conteudo, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Abre uma janela de impressão com cabeçalho institucional. */
function imprimir(titulo, corpoHTML, { paisagem = true } = {}) {
  const logo = new URL("assets/logo.png", location.href).href;
  const w = window.open("", "_blank");
  if (!w) { toast("Permita pop-ups para imprimir.", true); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
  <style>
    @page{size:A4 ${paisagem ? "landscape" : "portrait"};margin:12mm}
    body{font:11px "IBM Plex Sans",Arial,sans-serif;color:#000;margin:0}
    .cab{display:flex;gap:14px;align-items:center;border-bottom:1.5px solid #000;padding-bottom:8px;margin-bottom:12px}
    .cab img{height:48px}.cab b{font-size:12px}
    h1{font:700 16px Georgia,serif;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:.5px solid #999;text-align:left}
    th{border-bottom:1.5px solid #000;font-size:10px;text-transform:uppercase}
    .num{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border-top:1.5px solid #000}
    .cod{font-family:Consolas,monospace}.linha{border-bottom:1px solid #000;min-width:80px;display:inline-block}
    .assin{display:flex;gap:40px;margin-top:50px}.assin div{flex:1;border-top:1px solid #000;text-align:center;padding-top:4px}
    .meta{margin:0 0 10px;line-height:1.6}
  </style></head><body>
  <div class="cab"><img src="${logo}" alt=""><div><b>${esc(INSTITUICAO.nomeCompleto)}</b><br>${esc(INSTITUICAO.unidade)} — ${esc(INSTITUICAO.sistema)}<br><small>Emitido em ${new Date().toLocaleString("pt-BR")} por ${esc(S.perfil?.nome || S.email)}</small></div></div>
  <h1>${esc(titulo)}</h1>${corpoHTML}
  <script>window.onload=()=>{setTimeout(()=>window.print(),300)}<\/script></body></html>`);
  w.document.close();
}

/* ---------------------------------------------------------------- Telas */
function mostrar(tela) {
  for (const id of ["tela-carregando", "tela-login", "tela-bloqueio", "app"]) $("#" + id).hidden = id !== tela;
}

function preencherInstitucional() {
  $$("[data-inst]").forEach(el => { el.textContent = INSTITUICAO[el.dataset.inst] || ""; });
  document.title = `${INSTITUICAO.sistema} — ${INSTITUICAO.sigla}`;
  $("#btn-google").hidden = !LOGIN.google;
  $("#bloco-email").hidden = !LOGIN.emailSenha;
  if (!LOGIN.google) $(".divisor")?.remove();
}

function bloquear(titulo, texto, { verificacao = false } = {}) {
  $("#bloq-titulo").textContent = titulo;
  $("#bloq-texto").innerHTML = texto;
  $("#btn-reenviar").hidden = $("#btn-recarregar").hidden = !verificacao;
  mostrar("tela-bloqueio");
}

/* ---------------------------------------------------------------- Autenticação */
function msgLogin(t, ok = false) { const m = $("#login-msg"); m.textContent = t; m.classList.toggle("ok", ok); }

$("#btn-google").onclick = async () => {
  msgLogin("");
  try {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, p);
  } catch (e) { msgLogin(msgErro(e)); }
};

$("#form-login").onsubmit = async ev => {
  ev.preventDefault(); msgLogin("");
  const email = $("#login-email").value.trim(), senha = $("#login-senha").value;
  if (!email || !senha) return msgLogin("Informe e-mail e senha.");
  try { await signInWithEmailAndPassword(auth, email, senha); }
  catch (e) { msgLogin(msgErro(e)); }
};

$("#btn-primeiro-acesso").onclick = async () => {
  msgLogin("");
  const email = $("#login-email").value.trim(), senha = $("#login-senha").value;
  if (!email || senha.length < 6) return msgLogin("Para o primeiro acesso, preencha seu e-mail autorizado e crie uma senha (mín. 6 caracteres) nos campos acima.");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await sendEmailVerification(cred.user);
  } catch (e) { msgLogin(msgErro(e)); }
};

$("#btn-esqueci").onclick = async () => {
  const email = $("#login-email").value.trim();
  if (!email) return msgLogin("Digite seu e-mail no campo acima e clique novamente em \"Esqueci a senha\".");
  try { await sendPasswordResetEmail(auth, email); msgLogin("Se o e-mail estiver cadastrado, você receberá o link de redefinição.", true); }
  catch (e) { msgLogin(msgErro(e)); }
};

$("#btn-reenviar").onclick = async () => {
  try { await sendEmailVerification(auth.currentUser); toast("E-mail de verificação reenviado."); }
  catch (e) { toast(msgErro(e), true); }
};
$("#btn-recarregar").onclick = async () => {
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  verificarAcesso(auth.currentUser);
};
$("#btn-sair-bloq").onclick = $("#btn-sair").onclick = () => signOut(auth);

onAuthStateChanged(auth, user => {
  if (!CONFIG_OK) return;
  encerrarOuvintes();
  S.user = user; S.perfil = null;
  if (!user) { mostrar("tela-login"); return; }
  verificarAcesso(user);
});

async function verificarAcesso(user) {
  mostrar("tela-carregando");
  S.email = emailNorm(user.email);
  if (!user.emailVerified) {
    return bloquear("Confirme seu e-mail",
      `Enviamos um link de verificação para <b>${esc(user.email)}</b>. Abra o link (verifique também o spam) e depois clique em <i>Já verifiquei</i>.`,
      { verificacao: true });
  }
  try {
    const snap = await getDoc(doc(colUsu, S.email));
    if (!snap.exists() || snap.data().ativo !== true) throw { code: "nao-autorizado" };
    S.perfil = snap.data();
    iniciarApp();
  } catch (e) {
    const negado = e.code === "nao-autorizado" || e.code === "permission-denied";
    bloquear("Acesso não autorizado", negado
      ? `O e-mail <b>${esc(user.email)}</b> não está na lista de usuários autorizados (ou está desativado). Solicite a liberação ao administrador do sistema.`
      : `Não foi possível verificar o acesso: ${esc(msgErro(e))}`);
  }
}

/* ---------------------------------------------------------------- Inicialização */
function encerrarOuvintes() { S.unsubs.forEach(u => u()); S.unsubs = []; }

function iniciarApp() {
  document.body.dataset.papel = S.perfil.papel;
  $("#usuario-email").textContent = S.email;
  $("#papel-tag").textContent = ROTULO_PAPEL[S.perfil.papel] || S.perfil.papel;
  $("#m-ini").value = hojeISO().slice(0, 8) + "01";
  $("#m-fim").value = hojeISO();
  mostrar("app");
  irPara(S.vista);

  const opts = { includeMetadataChanges: true };
  S.unsubs.push(onSnapshot(colProd, opts, snap => {
    const off = snap.metadata.fromCache;
    $("#ponto-con").classList.toggle("off", off);
    $("#txt-con").textContent = off ? "sem conexão — exibindo dados em cache" : "conectado ao banco de dados";
    S.produtos = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    S.porId = new Map(S.produtos.map(p => [p.id, p]));
    S.abc = N.curvaABC(S.produtos.filter(p => p.ativo !== false));
    atualizarListas();
    renderPainel(); renderProdutos(); renderInventario();
    if (S.lanc) atualizarPreviaLanc();
  }, e => toast("Erro ao carregar produtos: " + msgErro(e), true)));

  S.unsubs.push(onSnapshot(query(colMov, orderBy("data", "desc"), limit(12)), snap => {
    S.recentes = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    renderPainel(); atualizarListas();
  }));

  const ini = new Date(); ini.setDate(1); ini.setHours(0, 0, 0, 0);
  S.unsubs.push(onSnapshot(query(colMov, where("data", ">=", Timestamp.fromDate(ini)), orderBy("data", "desc")), snap => {
    S.doMes = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    renderPainel(); atualizarListas();
  }));

  if (ehAdmin()) {
    S.unsubs.push(onSnapshot(colUsu, snap => {
      S.usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsuarios();
    }, e => toast("Erro ao carregar usuários: " + msgErro(e), true)));
  }
}

/* ---------------------------------------------------------------- Navegação */
function irPara(vista) {
  if (vista === "usuarios" && !ehAdmin()) vista = "painel";
  S.vista = vista;
  $$(".vista").forEach(v => v.hidden = v.id !== "v-" + vista);
  $$(".menu button").forEach(b => b.classList.toggle("ativo", b.dataset.vista === vista));
  $("#lateral").classList.remove("aberta");
  if (vista === "movimentos" && !S.movConsulta.length) consultarMovimentos();
  window.scrollTo(0, 0);
}
$$(".menu button").forEach(b => b.onclick = () => irPara(b.dataset.vista));
document.addEventListener("click", e => {
  const ir = e.target.closest("[data-ir]"); if (ir) irPara(ir.dataset.ir);
  const ac = e.target.closest("[data-acao]"); if (ac) abrirLancamento(ac.dataset.acao === "entrada" ? "ENTRADA" : "SAIDA", ac.dataset.prod);
});
$("#btn-menu").onclick = e => { e.stopPropagation(); $("#lateral").classList.toggle("aberta"); };
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$("#app").hidden) {
    e.preventDefault(); irPara("produtos"); $("#f-busca").focus();
  }
});

/* ---------------------------------------------------------------- Listas auxiliares */
function atualizarListas() {
  const ativos = S.produtos.filter(p => p.ativo !== false).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
  $("#lista-produtos").innerHTML = ativos.map(p => `<option value="${esc(p.codigo + " — " + p.descricao)}">`).join("");
  const cats = [...new Set(S.produtos.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#lista-categorias").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  for (const sel of ["#f-categoria", "#inv-categoria"]) {
    const atual = $(sel).value;
    $(sel).innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option${c === atual ? " selected" : ""}>${esc(c)}</option>`).join("");
  }
  const movs = [...S.recentes, ...S.doMes, ...S.movConsulta];
  const unicos = tipo => [...new Set(movs.filter(m => m.tipo === tipo).map(m => m.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#lista-setores").innerHTML = unicos("SAIDA").map(s => `<option value="${esc(s)}">`).join("");
  $("#lista-fornecedores").innerHTML = unicos("ENTRADA").map(s => `<option value="${esc(s)}">`).join("");
}

function situacao(p) {
  if (p.ativo === false) return "inativo";
  if ((p.quantidade || 0) <= 0) return "zerado";
  if (p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo) return "repor";
  return "ok";
}
const ROTULO_SIT = { inativo: "Inativo", zerado: "Zerado", repor: "Repor", ok: "Normal" };

/* ---------------------------------------------------------------- PAINEL */
function renderPainel() {
  const c = N.consolidar(S.produtos);
  const saidasMes = S.doMes.filter(m => m.tipo === "SAIDA" && !m.estornadoPor);
  const entradasMes = S.doMes.filter(m => m.tipo === "ENTRADA" && !m.estornadoPor);
  const somaCent = l => l.reduce((s, m) => s + (m.valorTotalCent || 0), 0);
  const mesNome = new Date().toLocaleDateString("pt-BR", { month: "long" });

  $("#kpis").innerHTML = [
    { s: "VT", cor: "#0F2A3D", rot: "Valor total em estoque", val: N.fmtCent(c.valorCent), det: `${c.ativos} itens ativos` },
    { s: "REP", cor: "#C2571A", rot: "Itens para repor", val: c.abaixoMin + c.zerados, det: `${c.abaixoMin} abaixo do mínimo · ${c.zerados} zerados`, ir: "repor" },
    { s: "SAI", cor: "#9A2B1F", rot: `Retiradas em ${mesNome}`, val: N.fmtCent(somaCent(saidasMes)), det: `${saidasMes.length} lançamentos` },
    { s: "ENT", cor: "#2E8B57", rot: `Entradas em ${mesNome}`, val: N.fmtCent(somaCent(entradasMes)), det: `${entradasMes.length} lançamentos` },
  ].map(k => `<div class="kpi${k.ir ? " clicavel" : ""}" ${k.ir ? `data-filtro="${k.ir}"` : ""}>
      <span class="sigla" style="background:${k.cor}">${k.s}</span>
      <span class="rot">${esc(k.rot)}</span><span class="val">${esc(k.val)}</span><span class="det">${esc(k.det)}</span></div>`).join("");
  $$("#kpis [data-filtro]").forEach(k => k.onclick = () => { $("#f-situacao").value = k.dataset.filtro; irPara("produtos"); renderProdutos(); });

  const repor = S.produtos.filter(p => ["repor", "zerado"].includes(situacao(p)))
    .sort((a, b) => (a.quantidade / (a.estoqueMinimo || 1)) - (b.quantidade / (b.estoqueMinimo || 1)));
  $("#lista-reposicao").innerHTML = repor.length ? repor.map(p => `
    <div class="lista-item"><div class="desc"><b>${esc(p.descricao)}</b><span class="mono muted">${esc(p.codigo)}</span></div>
    <div class="num"><span class="etq etq-${situacao(p)}">${N.fmtQtd(p.quantidade)} / mín. ${N.fmtQtd(p.estoqueMinimo)} ${esc(p.unidade)}</span>
    ${podeEscrever() ? `<button class="btn btn-mini" data-acao="entrada" data-prod="${esc(p.id)}">Entrada</button>` : ""}</div></div>`).join("")
    : `<div class="vazio">Nenhum item abaixo do estoque mínimo.</div>`;

  const tot = { A: [0, 0], B: [0, 0], C: [0, 0] };
  for (const p of S.produtos) { const k = S.abc.get(p.id); if (k) { tot[k][0]++; tot[k][1] += p.valorTotalCent; } }
  const vt = c.valorCent || 1, cores = { A: "#0F2A3D", B: "#2F6DA3", C: "#9FB3C3" };
  $("#abc-resumo").innerHTML = c.valorCent ? `
    <div class="barra" style="margin-bottom:10px">${["A", "B", "C"].map(k => `<i style="width:${tot[k][1] / vt * 100}%;background:${cores[k]}"></i>`).join("")}</div>
    ${["A", "B", "C"].map(k => `<div class="abc-linha"><span class="etq etq-${k}">${k}</span>
      <span class="pequeno">${tot[k][0]} itens · ${(tot[k][1] / vt * 100).toFixed(1).replace(".", ",")}% do valor</span>
      <span class="num mono">${N.fmtCent(tot[k][1])}</span>
      <button class="link pequeno" data-abc="${k}">filtrar</button></div>`).join("")}
    <p class="muted pequeno" style="margin:8px 0 0">A: itens que somam até 80% do valor — prioridade máxima de controle e contagem. B: até 95%. C: demais.</p>`
    : `<div class="vazio">Sem valor em estoque.</div>`;
  $$("#abc-resumo [data-abc]").forEach(b => b.onclick = () => { $("#f-abc").value = b.dataset.abc; irPara("produtos"); renderProdutos(); });

  $("#tab-recentes").innerHTML = theadMov(false) + `<tbody>${S.recentes.map(m => linhaMov(m, false)).join("") ||
    `<tr><td colspan="9" class="vazio">Nenhuma movimentação registrada.</td></tr>`}</tbody>`;
}

function theadMov(completo) {
  return `<thead><tr><th>Data</th><th>Tipo</th><th>Código</th><th>Descrição</th><th class="num">Qtd</th>
    ${completo ? `<th class="num">Valor unit.</th>` : ""}<th class="num">Valor</th><th>Setor / requisitante</th><th>Documento</th>${completo ? "<th>Usuário</th>" : ""}<th class="acts"></th></tr></thead>`;
}
function etiquetasMov(m) {
  const hist = (m.historico || []).map(h => `${new Date(h.em).toLocaleString("pt-BR")} — ${h.nome || h.por}: ` +
    Object.entries(h.alteracoes || {}).map(([k, v]) => `${k} "${v.de || "—"}" → "${v.para || "—"}"`).join("; ")).join("\n");
  return `<span class="etq etq-${m.tipo}">${ROTULO_TIPO[m.tipo] || m.tipo}</span>` +
    (m.estornadoPor ? ` <span class="etq etq-estornado" title="${esc("Estornado por " + (m.estornadoPorEmail || "") + " — " + (m.motivoEstorno || ""))}">Estornado</span>` : "") +
    (hist ? `<span class="marca-corr" title="${esc("Dados corrigidos:\n" + hist)}">✎ corrigido</span>` : "");
}
function acoesMov(m) {
  if (!podeEscrever() || !m.id) return "";
  const podeEstornar = !m.estornadoPor && !ehEstorno(m.tipo);
  return `${podeEstornar ? `<button class="btn btn-mini" data-estornar="${esc(m.id)}" title="Anular por lançamento inverso">Estornar</button>` : ""}
    <button class="btn btn-mini" data-corrigir="${esc(m.id)}" title="Corrigir setor, documento ou observação">Corrigir</button>`;
}
function linhaMov(m, completo) {
  const sinal = ehEntrada(m.tipo) ? "+" : "−";
  return `<tr class="${m.estornadoPor ? "estornado" : ""}"><td class="mono">${fmtData(m.data)}</td><td>${etiquetasMov(m)}</td>
    <td class="cod">${esc(m.codigo)}</td><td>${esc(m.descricao)}</td>
    <td class="num">${sinal}${N.fmtQtd(m.quantidade)}</td>
    ${completo ? `<td class="num">${N.fmtUnit(m.valorUnitario)}</td>` : ""}
    <td class="num">${N.fmtCent(m.valorTotalCent)}</td><td>${esc(m.setor || "—")}</td><td>${esc(m.documento || "—")}</td>
    ${completo ? `<td class="pequeno">${esc(m.usuarioNome || m.usuarioEmail)}</td>` : ""}<td class="acts">${acoesMov(m)}</td></tr>`;
}

/* ---------------------------------------------------------------- PRODUTOS */
function produtosFiltrados() {
  const busca = N.normalizar($("#f-busca").value), cat = $("#f-categoria").value,
    sit = $("#f-situacao").value, abc = $("#f-abc").value;
  const { campo, dir } = S.ordem;
  return S.produtos.filter(p => {
    const s = situacao(p);
    if (sit ? s !== sit : s === "inativo") return false;
    if (cat && p.categoria !== cat) return false;
    if (abc && S.abc.get(p.id) !== abc) return false;
    if (busca && !N.normalizar(`${p.codigo} ${p.descricao} ${p.localizacao || ""}`).includes(busca)) return false;
    return true;
  }).sort((a, b) => {
    const va = a[campo], vb = b[campo];
    return (typeof va === "number" ? va - vb : String(va || "").localeCompare(String(vb || ""), "pt-BR", { numeric: true })) * dir;
  });
}

function renderProdutos() {
  const lista = produtosFiltrados();
  const th = (rot, campo, cls = "") => `<th class="ord ${cls}" data-ord="${campo}">${rot}${S.ordem.campo === campo ? (S.ordem.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  const totalCent = lista.reduce((s, p) => s + (p.valorTotalCent || 0), 0);
  const esc_ = podeEscrever();
  $("#tab-produtos").innerHTML = `<thead><tr>${th("Código", "codigo")}${th("Descrição", "descricao")}<th>Un.</th>
    ${th("Quantidade", "quantidade", "num")}${th("Valor unitário (CMP)", "custoMedio", "num")}${th("Valor total", "valorTotalCent", "num")}
    <th class="num">Mín.</th><th>Curva</th><th>Situação</th><th class="acts"></th></tr></thead>
    <tbody>${lista.map(p => {
      const s = situacao(p), k = S.abc.get(p.id);
      return `<tr class="${s === "inativo" ? "inativo" : ""}">
        <td class="cod">${esc(p.codigo)}</td>
        <td class="col-desc"><b>${esc(p.descricao)}</b>${p.categoria || p.localizacao ? `<br><span class="muted pequeno">${esc([p.categoria, p.localizacao].filter(Boolean).join(" · "))}</span>` : ""}</td>
        <td>${esc(p.unidade)}</td>
        <td class="num"><b>${N.fmtQtd(p.quantidade)}</b></td>
        <td class="num">${N.fmtUnit(p.custoMedio)}</td>
        <td class="num"><b>${N.fmtCent(p.valorTotalCent)}</b></td>
        <td class="num muted">${p.estoqueMinimo ? N.fmtQtd(p.estoqueMinimo) : "—"}</td>
        <td>${k ? `<span class="etq etq-${k}">${k}</span>` : ""}</td>
        <td><span class="etq etq-${s}">${ROTULO_SIT[s]}</span></td>
        <td class="acts">
          ${esc_ && s !== "inativo" ? `<button class="btn btn-mini btn-saida" data-acao="saida" data-prod="${esc(p.id)}" ${p.quantidade > 0 ? "" : "disabled"}>Retirar</button>
            <button class="btn btn-mini" data-acao="entrada" data-prod="${esc(p.id)}">Entrada</button>` : ""}
          <button class="btn btn-mini" data-ficha="${esc(p.id)}">Ficha</button>
          ${esc_ ? `<button class="btn btn-mini" data-editar="${esc(p.id)}">Editar</button>` : ""}
          ${ehAdmin() && s === "inativo" && !p.quantidade ? `<button class="btn btn-mini" data-excluir="${esc(p.id)}">Excluir</button>` : ""}
        </td></tr>`;
    }).join("") || `<tr><td colspan="10" class="vazio">Nenhum produto encontrado.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="5">${lista.length} ${lista.length === 1 ? "item" : "itens"}</td><td class="num">${N.fmtCent(totalCent)}</td><td colspan="4"></td></tr></tfoot>`;

  $$("#tab-produtos [data-ord]").forEach(h => h.onclick = () => {
    const c = h.dataset.ord;
    S.ordem = { campo: c, dir: S.ordem.campo === c ? -S.ordem.dir : (["quantidade", "valorTotalCent", "custoMedio"].includes(c) ? -1 : 1) };
    renderProdutos();
  });
  $$("#tab-produtos [data-ficha]").forEach(b => b.onclick = () => abrirFicha(b.dataset.ficha));
  $$("#tab-produtos [data-editar]").forEach(b => b.onclick = () => abrirProduto(b.dataset.editar));
  $$("#tab-produtos [data-excluir]").forEach(b => b.onclick = () => excluirProduto(b.dataset.excluir));
}
for (const id of ["#f-busca", "#f-categoria", "#f-situacao", "#f-abc"]) $(id).addEventListener("input", renderProdutos);

$("#btn-exp-prod").onclick = () => {
  const l = produtosFiltrados();
  baixar(`posicao-estoque-${hojeISO()}.csv`, N.paraCSV([
    ["Código", "Descrição", "Unidade", "Categoria", "Localização", "Quantidade", "Valor unitário (CMP)", "Valor total", "Estoque mínimo", "Curva ABC", "Situação"],
    ...l.map(p => [p.codigo, p.descricao, p.unidade, p.categoria || "", p.localizacao || "",
      N.fmtQtd(p.quantidade), String(p.custoMedio || 0).replace(".", ","), ((p.valorTotalCent || 0) / 100).toFixed(2).replace(".", ","),
      N.fmtQtd(p.estoqueMinimo || 0), S.abc.get(p.id) || "", ROTULO_SIT[situacao(p)]]),
  ]));
};

$("#btn-imprimir-prod").onclick = () => {
  const l = produtosFiltrados(), tot = l.reduce((s, p) => s + (p.valorTotalCent || 0), 0);
  imprimir(`Posição de estoque em ${new Date().toLocaleDateString("pt-BR")}`, `<table><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th>
    <th class="num">Quantidade</th><th class="num">Valor unitário (CMP)</th><th class="num">Valor total</th><th>Situação</th></tr></thead><tbody>
    ${l.map(p => `<tr><td class="cod">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade)}</td><td class="num">${N.fmtQtd(p.quantidade)}</td>
    <td class="num">${N.fmtUnit(p.custoMedio)}</td><td class="num">${N.fmtCent(p.valorTotalCent)}</td><td>${ROTULO_SIT[situacao(p)]}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="5">${l.length} itens</td><td class="num">${N.fmtCent(tot)}</td><td></td></tr></tfoot></table>
    <div class="assin"><div>Responsável pelo almoxarifado</div><div>Chefia imediata</div></div>`);
};

/* ---------------------------------------------------------------- CADASTRO / EDIÇÃO */
function abrirProduto(id = null) {
  const p = id ? S.porId.get(id) : null;
  S.editando = id;
  $("#dp-titulo").textContent = p ? "Editar produto" : "Novo produto";
  $("#p-codigo").value = p?.codigo || ""; $("#p-codigo").readOnly = !!p;
  $("#p-descricao").value = p?.descricao || "";
  $("#p-unidade").value = p?.unidade || "UN";
  $("#p-categoria").value = p?.categoria || "";
  $("#p-local").value = p?.localizacao || "";
  $("#p-minimo").value = p?.estoqueMinimo ? N.fmtQtd(p.estoqueMinimo) : "";
  $("#p-qtd").value = ""; $("#p-vu").value = ""; $("#p-vt").textContent = N.fmtCent(0);
  $("#p-saldo-inicial").hidden = !!p;
  $("#p-ativo-wrap").hidden = !p; $("#p-ativo").checked = p ? p.ativo !== false : true;
  $("#dp-msg").textContent = "";
  $$("#form-produto input").forEach(i => i.classList.remove("erro"));
  $("#dlg-produto").showModal();
  (p ? $("#p-descricao") : $("#p-codigo")).focus();
}
$("#btn-novo-prod").onclick = () => abrirProduto();
for (const id of ["#p-qtd", "#p-vu"]) $(id).addEventListener("input", () => {
  const q = N.lerNumeroBR($("#p-qtd").value), v = N.lerNumeroBR($("#p-vu").value);
  $("#p-vt").textContent = N.fmtReais(q > 0 && v >= 0 ? q * v : 0);
});

$("#form-produto").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("#dp-msg"); msg.textContent = "";
  $$("#form-produto input").forEach(i => i.classList.remove("erro"));
  const falha = (campo, t) => { $(campo).classList.add("erro"); $(campo).focus(); msg.textContent = t; };

  const dados = {
    descricao: $("#p-descricao").value.trim(),
    unidade: $("#p-unidade").value.trim().toUpperCase(),
    categoria: $("#p-categoria").value.trim(),
    localizacao: $("#p-local").value.trim(),
    estoqueMinimo: $("#p-minimo").value.trim() ? N.arredQtd(N.lerNumeroBR($("#p-minimo").value)) : 0,
  };
  if (!$("#p-codigo").value.trim()) return falha("#p-codigo", "Informe o código do produto.");
  if (!dados.descricao) return falha("#p-descricao", "Informe a descrição.");
  if (!dados.unidade) return falha("#p-unidade", "Informe a unidade de medida.");
  if (!(dados.estoqueMinimo >= 0)) return falha("#p-minimo", "Estoque mínimo inválido.");

  const btn = $("#dp-salvar"); btn.disabled = true;
  try {
    if (S.editando) {
      const atual = S.porId.get(S.editando);
      const ativo = $("#p-ativo").checked;
      if (!ativo && atual.quantidade > 0) return falha("#p-ativo", "Para inativar, zere o saldo antes (retirada ou ajuste de inventário).");
      await updateDoc(doc(colProd, S.editando), { ...dados, ativo, atualizadoEm: serverTimestamp(), atualizadoPor: S.email });
      toast("Produto atualizado.");
    } else {
      let id;
      try { id = N.idDoCodigo($("#p-codigo").value); } catch (e) { return falha("#p-codigo", e.message); }
      const qtdTxt = $("#p-qtd").value.trim(), vuTxt = $("#p-vu").value.trim();
      const qtd = qtdTxt ? N.lerNumeroBR(qtdTxt) : 0, vu = vuTxt ? N.lerNumeroBR(vuTxt) : 0;
      if (!(qtd >= 0)) return falha("#p-qtd", "Quantidade inicial inválida.");
      if (!(vu >= 0)) return falha("#p-vu", "Valor unitário inválido.");
      if (qtd > 0 && !vuTxt) return falha("#p-vu", "Informe o valor unitário do saldo inicial.");
      await criarProduto(id, { codigo: $("#p-codigo").value.trim().toUpperCase(), ...dados }, qtd, vu, "Cadastro inicial");
      toast("Produto cadastrado.");
    }
    $("#dlg-produto").close();
  } catch (e) { msg.textContent = msgErro(e); }
  finally { btn.disabled = false; }
});

async function criarProduto(id, dados, qtd, vu, documento) {
  const ref = doc(colProd, id);
  await runTransaction(db, async tx => {
    if ((await tx.get(ref)).exists()) throw new Error(`Já existe produto com o código ${dados.codigo}.`);
    let estado = { quantidade: 0, valorTotalCent: 0 }, movId = null, r = null;
    if (qtd > 0) {
      r = N.aplicarEntrada(estado, qtd, vu); estado = r.novo;
      const movRef = doc(colMov); movId = movRef.id;
      tx.set(movRef, montarMov("SALDO_INICIAL", id, dados, r, estado, { documento, setor: "", observacao: "" }));
    }
    tx.set(ref, {
      ...dados, quantidade: estado.quantidade, valorTotalCent: estado.valorTotalCent,
      custoMedio: N.custoMedio(estado), ultimoCustoUnit: r ? r.valorUnit : 0, ultimoMovimentoId: movId, ativo: true,
      criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(), atualizadoPor: S.email,
    });
  });
}

function montarMov(tipo, produtoId, prod, r, novo, extra, loteId = null) {
  return {
    tipo, produtoId, codigo: prod.codigo, descricao: prod.descricao, unidade: prod.unidade,
    quantidade: r.quantidade, valorUnitario: Math.round(r.valorUnit * 10000) / 10000, valorTotalCent: r.valorMovCent,
    saldoQtd: novo.quantidade, saldoValorCent: novo.valorTotalCent, custoMedioApos: N.custoMedio(novo),
    setor: extra.setor || "", documento: extra.documento || "", observacao: extra.observacao || "",
    loteId, usuarioEmail: S.email, usuarioNome: S.perfil?.nome || "", data: serverTimestamp(),
  };
}

async function excluirProduto(id) {
  const p = S.porId.get(id);
  if (!await confirmar("Excluir produto", `<p>Excluir definitivamente <b>${esc(p.codigo)} — ${esc(p.descricao)}</b>?</p><p class="muted">As movimentações históricas são preservadas.</p>`, "Excluir")) return;
  try { await deleteDoc(doc(colProd, id)); toast("Produto excluído."); } catch (e) { toast(msgErro(e), true); }
}

/* ---------------------------------------------------------------- IMPORTAÇÃO CSV */
$("#inp-import").onchange = async ev => {
  const arq = ev.target.files[0]; ev.target.value = "";
  if (!arq) return;
  const linhas = N.lerCSV(await arq.text());
  if (linhas.length < 2) return toast("Arquivo vazio ou sem dados.", true);
  const cab = linhas[0].map(h => N.normalizar(h).replace(/[^a-z]/g, ""));
  const col = (...nomes) => cab.findIndex(h => nomes.includes(h));
  const ix = {
    codigo: col("codigo", "cod", "codigodoproduto"), descricao: col("descricao", "produto"), unidade: col("unidade", "un", "und"),
    quantidade: col("quantidade", "qtd", "qtde"), vu: col("valorunitario", "vlunitario", "valorunit", "preco"),
    categoria: col("categoria"), minimo: col("estoqueminimo", "minimo"), local: col("localizacao", "local"),
  };
  if (ix.codigo < 0 || ix.descricao < 0) return toast("O CSV precisa das colunas 'codigo' e 'descricao' (veja o modelo no README).", true);

  const itens = [], erros = [];
  linhas.slice(1).forEach((l, i) => {
    const g = k => ix[k] >= 0 ? (l[ix[k]] || "").trim() : "";
    try {
      const id = N.idDoCodigo(g("codigo"));
      if (!g("descricao")) throw new Error("sem descrição");
      const qtd = g("quantidade") ? N.lerNumeroBR(g("quantidade")) : 0, vu = g("vu") ? N.lerNumeroBR(g("vu")) : 0;
      const min = g("minimo") ? N.lerNumeroBR(g("minimo")) : 0;
      if (!(qtd >= 0) || !(vu >= 0) || !(min >= 0)) throw new Error("número inválido");
      if (S.porId.has(id) || itens.some(x => x.id === id)) throw new Error("código já existe");
      itens.push({ id, qtd, vu, dados: { codigo: g("codigo").toUpperCase(), descricao: g("descricao"), unidade: (g("unidade") || "UN").toUpperCase(), categoria: g("categoria"), localizacao: g("local"), estoqueMinimo: N.arredQtd(min) } });
    } catch (e) { erros.push(`Linha ${i + 2}: ${e.message}`); }
  });
  const total = itens.reduce((s, x) => s + Math.round(x.qtd * x.vu * 100), 0);
  const ok = await confirmar("Importar produtos", `<p><b>${itens.length}</b> produtos novos, valor total de <b>${N.fmtCent(total)}</b>.</p>
    ${erros.length ? `<p class="msg">${erros.length} linha(s) ignorada(s):</p><pre class="mono" style="max-height:160px;overflow:auto">${esc(erros.join("\n"))}</pre>` : ""}`, "Importar");
  if (!ok || !itens.length) return;
  let feitos = 0; const falhas = [];
  for (const x of itens) {
    try { await criarProduto(x.id, x.dados, x.qtd, x.vu, `Importação ${arq.name}`); feitos++; }
    catch (e) { falhas.push(`${x.dados.codigo}: ${msgErro(e)}`); }
  }
  toast(`${feitos} produto(s) importado(s).${falhas.length ? ` ${falhas.length} falha(s).` : ""}`, falhas.length > 0);
  if (falhas.length) console.warn(falhas.join("\n"));
};

/* ---------------------------------------------------------------- ENTRADA / RETIRADA (multi-itens) */
function abrirLancamento(tipo, prodId = null) {
  if (!podeEscrever()) return;
  S.lanc = { tipo, itens: [] };
  const saida = tipo === "SAIDA";
  $("#dl-titulo").textContent = saida ? "Registrar retirada" : "Registrar entrada";
  $("#dl-setor-wrap").firstChild.textContent = saida ? "Setor / requisitante *" : "Fornecedor / origem";
  $("#dl-setor").placeholder = saida ? "Ex.: SUFAM — João da Silva" : "Ex.: Empresa X — Pregão 12/2026";
  $("#dl-setor").setAttribute("list", saida ? "lista-setores" : "lista-fornecedores");
  $("#dl-doc").placeholder = saida ? "Nº SEI ou requisição" : "Nota fiscal / Nº SEI";
  $("#dl-confirmar").textContent = saida ? "Confirmar retirada" : "Confirmar entrada";
  $("#dl-confirmar").className = "btn " + (saida ? "btn-saida" : "btn-prim");
  for (const id of ["#dl-setor", "#dl-doc", "#dl-obs"]) $(id).value = "";
  $("#dl-msg").textContent = "";
  addItemLanc(prodId);
  $("#dlg-lanc").showModal();
  (prodId ? $("#tab-lanc .in-qtd") : $("#tab-lanc .in-prod"))?.focus();
}

function addItemLanc(prodId = null) {
  if (S.lanc.itens.length >= MAX_ITENS_POR_LANCAMENTO) return toast(`Máximo de ${MAX_ITENS_POR_LANCAMENTO} itens por lançamento.`, true);
  const p = prodId ? S.porId.get(prodId) : null;
  S.lanc.itens.push({ prodTxt: p ? `${p.codigo} — ${p.descricao}` : "", qtdTxt: "", vuTxt: "" });
  renderLanc();
}

/**
 * Localiza o produto digitado: aceita a sugestão da lista ("COD — descrição"),
 * só o código, a descrição completa ou parte única dela.
 * Devolve { p } ou { erro }.
 */
function resolverProd(txt) {
  const t = String(txt || "").trim();
  if (!t) return { erro: "Informe o produto" };
  const ativos = S.produtos.filter(p => p.ativo !== false);
  if (!ativos.length) return { erro: "Nenhum produto cadastrado — cadastre primeiro em Produtos" };
  try { // 1) código (ou "código — descrição" escolhido na lista)
    const p = S.porId.get(N.idDoCodigo(t.split(" — ")[0]));
    if (p && p.ativo !== false) return { p };
  } catch { /* não é código válido */ }
  const n = N.normalizar(t).replace(/\s+/g, " ");
  const exatos = ativos.filter(p => N.normalizar(p.descricao).replace(/\s+/g, " ") === n);
  if (exatos.length === 1) return { p: exatos[0] };
  const parciais = ativos.filter(p => N.normalizar(`${p.codigo} ${p.descricao}`).replace(/\s+/g, " ").includes(n));
  if (parciais.length === 1) return { p: parciais[0] };
  if (parciais.length > 1 || exatos.length > 1) return { erro: `${Math.max(parciais.length, exatos.length)} produtos correspondem — escolha na lista de sugestões` };
  return { erro: "Produto não cadastrado — cadastre primeiro em Produtos" };
}

function renderLanc() {
  const saida = S.lanc.tipo === "SAIDA";
  $("#tab-lanc").innerHTML = `<thead><tr><th>Produto (código ou descrição)</th><th class="num">Quantidade</th>${saida ? "" : `<th class="num">Valor unitário</th>`}<th>Prévia do recálculo</th><th></th></tr></thead>
    <tbody>${S.lanc.itens.map((it, i) => `<tr data-i="${i}">
      <td><input class="in-prod" list="lista-produtos" value="${esc(it.prodTxt)}" placeholder="Digite para buscar…"></td>
      <td><input class="in-num in-qtd" inputmode="decimal" value="${esc(it.qtdTxt)}"></td>
      ${saida ? "" : `<td><input class="in-num in-vu" inputmode="decimal" value="${esc(it.vuTxt)}" placeholder="0,00"></td>`}
      <td class="info"></td>
      <td>${S.lanc.itens.length > 1 ? `<button type="button" class="btn btn-mini" data-rm="${i}" aria-label="Remover">✕</button>` : ""}</td></tr>`).join("")}</tbody>`;
  $$("#tab-lanc tbody tr").forEach(tr => {
    const it = S.lanc.itens[+tr.dataset.i];
    const inProd = tr.querySelector(".in-prod");
    inProd.oninput = e => { it.prodTxt = e.target.value; atualizarPreviaLanc(); };
    inProd.onchange = () => {
      const { p } = resolverProd(inProd.value);
      if (p) { it.prodTxt = inProd.value = `${p.codigo} — ${p.descricao}`; atualizarPreviaLanc(); }
    };
    tr.querySelector(".in-qtd").oninput = e => { it.qtdTxt = e.target.value; atualizarPreviaLanc(); };
    const vu = tr.querySelector(".in-vu"); if (vu) vu.oninput = e => { it.vuTxt = e.target.value; atualizarPreviaLanc(); };
  });
  $$("#tab-lanc [data-rm]").forEach(b => b.onclick = () => { S.lanc.itens.splice(+b.dataset.rm, 1); renderLanc(); });
  atualizarPreviaLanc();
}

/** Calcula cada linha com base no saldo atual; devolve [{p, r}|{erro}] */
function calcularLanc() {
  const saida = S.lanc.tipo === "SAIDA", vistos = new Set();
  return S.lanc.itens.map(it => {
    if (!it.prodTxt.trim() && !it.qtdTxt.trim()) return { vazio: true };
    const { p, erro } = resolverProd(it.prodTxt);
    if (!p) return { erro };
    if (vistos.has(p.id)) return { erro: "Produto repetido na lista", p };
    vistos.add(p.id);
    const q = N.lerNumeroBR(it.qtdTxt);
    if (!(q > 0)) return { erro: "Informe a quantidade", p, parcial: true };
    try {
      const est = { quantidade: p.quantidade, valorTotalCent: p.valorTotalCent };
      if (saida) return { p, q, r: N.aplicarSaida(est, q) };
      const vu = N.lerNumeroBR(it.vuTxt);
      if (!(vu >= 0)) return { erro: "Informe o valor unitário", p, parcial: true };
      return { p, q, vu, r: N.aplicarEntrada(est, q, vu) };
    } catch (e) { return { erro: e.message, p }; }
  });
}

function atualizarPreviaLanc() {
  if (!S.lanc) return;
  const res = calcularLanc();
  let tot = 0, n = 0;
  $$("#tab-lanc tbody tr").forEach((tr, i) => {
    const x = res[i], cel = tr.querySelector(".info");
    cel.classList.toggle("erro", !!x.erro && !x.parcial);
    if (x.vazio) cel.textContent = "";
    else if (x.erro) cel.innerHTML = x.p ? `Saldo: ${N.fmtQtd(x.p.quantidade)} ${esc(x.p.unidade)} · ${esc(x.erro)}` : esc(x.erro);
    else {
      tot += x.r.valorMovCent; n++;
      cel.innerHTML = `${N.fmtQtd(x.p.quantidade)} → <b>${N.fmtQtd(x.r.novo.quantidade)}</b> ${esc(x.p.unidade)} · ${N.fmtCent(x.r.valorMovCent)}<br>
        Valor total do item: ${N.fmtCent(x.p.valorTotalCent)} → <b>${N.fmtCent(x.r.novo.valorTotalCent)}</b> · CMP ${N.fmtUnit(x.r.custoMedio)}`;
    }
  });
  const estoque = N.consolidar(S.produtos).valorCent, saida = S.lanc.tipo === "SAIDA";
  $("#dl-totais").innerHTML = `<span>Itens válidos: <b>${n}</b></span><span>Valor do lançamento: <b>${N.fmtCent(tot)}</b></span>
    <span>Estoque total: <b>${N.fmtCent(estoque)}</b> → <b>${N.fmtCent(estoque + (saida ? -tot : tot))}</b></span>`;
}
$("#dl-add").onclick = () => addItemLanc();

$("#form-lanc").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (!S.lanc) return;
  const msg = $("#dl-msg"); msg.textContent = "";
  const saida = S.lanc.tipo === "SAIDA";
  const extra = { setor: $("#dl-setor").value.trim(), documento: $("#dl-doc").value.trim(), observacao: $("#dl-obs").value.trim() };
  if (saida && !extra.setor) { $("#dl-setor").focus(); return msg.textContent = "Informe o setor/requisitante da retirada."; }
  const res = calcularLanc().filter(x => !x.vazio);
  const ruim = res.find(x => x.erro);
  if (!res.length) return msg.textContent = "Inclua ao menos um item.";
  if (ruim) return msg.textContent = `Corrija os itens: ${ruim.erro}.`;

  const btn = $("#dl-confirmar"); btn.disabled = true;
  try {
    const loteId = doc(colMov).id, tipo = S.lanc.tipo;
    const resumo = await runTransaction(db, async tx => {
      const refs = res.map(x => doc(colProd, x.p.id));
      const snaps = await Promise.all(refs.map(r => tx.get(r)));   // todas as leituras antes das escritas
      const saidaLista = [];
      snaps.forEach((s, i) => {
        if (!s.exists()) throw new Error(`Produto ${res[i].p.codigo} não existe mais.`);
        const p = { id: s.id, ...s.data() };
        if (p.ativo === false) throw new Error(`Produto ${p.codigo} está inativo.`);
        const est = { quantidade: p.quantidade, valorTotalCent: p.valorTotalCent };
        const r = saida ? N.aplicarSaida(est, res[i].q) : N.aplicarEntrada(est, res[i].q, res[i].vu);
        saidaLista.push({ p, r, ref: refs[i] });
      });
      for (const { p, r, ref } of saidaLista) {
        const movRef = doc(colMov);
        tx.set(movRef, montarMov(tipo, p.id, p, r, r.novo, extra, loteId));
        tx.update(ref, {
          quantidade: r.novo.quantidade, valorTotalCent: r.novo.valorTotalCent, custoMedio: r.custoMedio,
          ...(saida ? {} : { ultimoCustoUnit: r.valorUnit }),
          ultimoMovimentoId: movRef.id, atualizadoEm: serverTimestamp(), atualizadoPor: S.email,
        });
      }
      return saidaLista;
    });
    $("#dlg-lanc").close(); S.lanc = null;
    const tot = resumo.reduce((s, x) => s + x.r.valorMovCent, 0);
    toast(`${saida ? "Retirada" : "Entrada"} registrada: ${resumo.length} item(ns), ${N.fmtCent(tot)}. Estoque recalculado.`);
    if (saida && await confirmar("Retirada registrada", `<p>Deseja imprimir o comprovante de retirada para assinatura do requisitante?</p>`, "Imprimir comprovante"))
      imprimirComprovante(resumo, extra, loteId);
  } catch (e) { msg.textContent = msgErro(e); }
  finally { btn.disabled = false; }
});
$("#dlg-lanc").addEventListener("close", () => { S.lanc = null; });

function imprimirComprovante(itens, extra, loteId) {
  const tot = itens.reduce((s, x) => s + x.r.valorMovCent, 0);
  imprimir("Comprovante de retirada de material", `<p class="meta">Controle: <span class="cod">${esc(loteId)}</span><br>
    Setor / requisitante: <b>${esc(extra.setor)}</b><br>Documento: ${esc(extra.documento || "—")}${extra.observacao ? `<br>Observação: ${esc(extra.observacao)}` : ""}</p>
    <table><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quantidade</th><th class="num">Valor unit.</th><th class="num">Valor</th></tr></thead><tbody>
    ${itens.map(({ p, r }) => `<tr><td class="cod">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade)}</td><td class="num">${N.fmtQtd(r.quantidade)}</td>
    <td class="num">${N.fmtUnit(r.valorUnit)}</td><td class="num">${N.fmtCent(r.valorMovCent)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="num">${N.fmtCent(tot)}</td></tr></tfoot></table>
    <div class="assin"><div>Entregue por: ${esc(S.perfil?.nome || S.email)}</div><div>Recebido por (nome e matrícula)</div></div>`, { paisagem: false });
}

/* ---------------------------------------------------------------- FICHA DO PRODUTO (Kardex) */
let fichaAtual = null;
async function abrirFicha(id) {
  const p = S.porId.get(id);
  $("#dk-titulo").textContent = `${p.codigo} — ${p.descricao}`;
  $("#dk-sub").textContent = `Saldo: ${N.fmtQtd(p.quantidade)} ${p.unidade} · CMP ${N.fmtUnit(p.custoMedio)} · Valor total ${N.fmtCent(p.valorTotalCent)}`;
  $("#tab-kardex").innerHTML = `<tbody><tr><td class="vazio">Carregando…</td></tr></tbody>`;
  $("#dlg-kardex").showModal();
  try {
    const snap = await getDocs(query(colMov, where("produtoId", "==", id)));
    const movs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (tsDate(a.data)?.getTime() || 0) - (tsDate(b.data)?.getTime() || 0));
    fichaAtual = { p, movs };
    $("#tab-kardex").innerHTML = `<thead><tr><th>Data</th><th>Tipo</th><th>Documento</th><th>Setor / origem</th><th class="num">Entrada</th><th class="num">Saída</th>
      <th class="num">Valor</th><th class="num">Saldo</th><th class="num">Saldo (R$)</th><th class="num">CMP</th><th>Usuário</th><th class="acts"></th></tr></thead>
      <tbody>${movs.map(m => `<tr class="${m.estornadoPor ? "estornado" : ""}"><td class="mono">${fmtData(m.data)}</td><td>${etiquetasMov(m)}</td>
        <td>${esc(m.documento || "—")}</td><td>${esc(m.setor || "—")}</td>
        <td class="num">${ehEntrada(m.tipo) ? N.fmtQtd(m.quantidade) : ""}</td><td class="num">${ehEntrada(m.tipo) ? "" : N.fmtQtd(m.quantidade)}</td>
        <td class="num">${N.fmtCent(m.valorTotalCent)}</td><td class="num"><b>${N.fmtQtd(m.saldoQtd)}</b></td><td class="num">${N.fmtCent(m.saldoValorCent)}</td>
        <td class="num">${N.fmtUnit(m.custoMedioApos)}</td><td class="pequeno">${esc(m.usuarioNome || m.usuarioEmail)}</td><td class="acts">${acoesMov(m)}</td></tr>`).join("")
        || `<tr><td colspan="12" class="vazio">Sem movimentações.</td></tr>`}</tbody>`;
  } catch (e) { $("#tab-kardex").innerHTML = `<tbody><tr><td class="msg">${esc(msgErro(e))}</td></tr></tbody>`; }
}
$("#dk-fechar").onclick = () => $("#dlg-kardex").close();
$("#dk-csv").onclick = () => {
  if (!fichaAtual) return;
  const { p, movs } = fichaAtual;
  baixar(`ficha-${p.id}.csv`, N.paraCSV([["Data", "Tipo", "Documento", "Setor/origem", "Entrada", "Saída", "Valor", "Saldo qtd", "Saldo R$", "CMP", "Usuário", "Situação"],
    ...movs.map(m => [fmtData(m.data), ROTULO_TIPO[m.tipo], m.documento, m.setor, ehEntrada(m.tipo) ? N.fmtQtd(m.quantidade) : "", ehEntrada(m.tipo) ? "" : N.fmtQtd(m.quantidade),
      (m.valorTotalCent / 100).toFixed(2).replace(".", ","), N.fmtQtd(m.saldoQtd), (m.saldoValorCent / 100).toFixed(2).replace(".", ","),
      String(m.custoMedioApos).replace(".", ","), m.usuarioNome || m.usuarioEmail, situacaoMov(m)])]));
};
function situacaoMov(m) {
  return [m.estornadoPor ? `Estornado: ${m.motivoEstorno || ""}` : "", m.estornoDe ? `Estorno — motivo: ${m.motivoEstorno || ""}` : "",
    (m.historico || []).length ? `Dados corrigidos (${m.historico.length}x)` : ""].filter(Boolean).join(" | ");
}

/* ---------------------------------------------------------------- MOVIMENTAÇÕES */
async function consultarMovimentos() {
  const ini = $("#m-ini").value, fim = $("#m-fim").value;
  if (!ini || !fim || ini > fim) return toast("Período inválido.", true);
  const dIni = new Date(ini + "T00:00:00"), dFim = new Date(fim + "T23:59:59.999");
  $("#tab-movimentos").innerHTML = `<tbody><tr><td class="vazio">Consultando…</td></tr></tbody>`;
  try {
    const snap = await getDocs(query(colMov, where("data", ">=", Timestamp.fromDate(dIni)), where("data", "<=", Timestamp.fromDate(dFim)), orderBy("data", "desc")));
    S.movConsulta = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    renderMovimentos();
  } catch (e) { $("#tab-movimentos").innerHTML = `<tbody><tr><td class="msg">${esc(msgErro(e))}</td></tr></tbody>`; }
}
function movsFiltrados() {
  const tipo = $("#m-tipo").value, busca = N.normalizar($("#m-busca").value);
  const passaTipo = m => !tipo || (tipo === "ESTORNADO" ? !!m.estornadoPor : tipo === "CORRIGIDO" ? (m.historico || []).length > 0 : m.tipo.startsWith(tipo));
  return S.movConsulta.filter(m => passaTipo(m) &&
    (!busca || N.normalizar(`${m.codigo} ${m.descricao} ${m.setor} ${m.documento} ${m.observacao} ${m.usuarioNome} ${m.usuarioEmail}`).includes(busca)));
}
function renderMovimentos() {
  const l = movsFiltrados();
  const soma = f => l.filter(f).reduce((s, m) => s + m.valorTotalCent, 0);
  $("#resumo-mov").innerHTML = `<span>Lançamentos: <b>${l.length}</b></span>
    <span>Entradas: <b>${N.fmtCent(soma(m => (m.tipo === "ENTRADA" || m.tipo === "SALDO_INICIAL") && !m.estornadoPor))}</b></span>
    <span>Retiradas: <b>${N.fmtCent(soma(m => m.tipo === "SAIDA" && !m.estornadoPor))}</b></span>
    <span>Ajustes (+/−): <b>${N.fmtCent(soma(m => m.tipo === "AJUSTE_POS" && !m.estornadoPor))}</b> / <b>${N.fmtCent(soma(m => m.tipo === "AJUSTE_NEG" && !m.estornadoPor))}</b></span>
    <span>Estornos: <b>${l.filter(m => ehEstorno(m.tipo)).length}</b></span>
    <span class="pequeno">(entradas, retiradas e ajustes já desconsideram os lançamentos estornados)</span>`;
  $("#tab-movimentos").innerHTML = theadMov(true) + `<tbody>${l.map(m => linhaMov(m, true)).join("") || `<tr><td colspan="11" class="vazio">Nenhuma movimentação no período.</td></tr>`}</tbody>`;
}
$("#btn-m-filtrar").onclick = consultarMovimentos;
for (const id of ["#m-ini", "#m-fim"]) $(id).onchange = consultarMovimentos;
for (const id of ["#m-tipo", "#m-busca"]) $(id).addEventListener("input", renderMovimentos);
$("#btn-exp-mov").onclick = () => baixar(`movimentacoes-${$("#m-ini").value}-a-${$("#m-fim").value}.csv`, N.paraCSV([
  ["Data", "Tipo", "Código", "Descrição", "Unidade", "Quantidade", "Valor unitário", "Valor total", "Saldo após", "Setor/origem", "Documento", "Observação", "Usuário", "Lote", "Situação"],
  ...movsFiltrados().map(m => [fmtData(m.data), ROTULO_TIPO[m.tipo], m.codigo, m.descricao, m.unidade, N.fmtQtd(m.quantidade),
    String(m.valorUnitario).replace(".", ","), (m.valorTotalCent / 100).toFixed(2).replace(".", ","), N.fmtQtd(m.saldoQtd),
    m.setor, m.documento, m.observacao, m.usuarioNome || m.usuarioEmail, m.loteId || "", situacaoMov(m)])]));
$("#btn-imprimir-mov").onclick = () => {
  const l = movsFiltrados();
  imprimir(`Movimentações de ${new Date($("#m-ini").value + "T12:00").toLocaleDateString("pt-BR")} a ${new Date($("#m-fim").value + "T12:00").toLocaleDateString("pt-BR")}`,
    `<table><thead><tr><th>Data</th><th>Tipo</th><th>Código</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Valor</th><th>Setor</th><th>Documento</th><th>Usuário</th></tr></thead><tbody>
    ${l.map(m => `<tr><td>${fmtData(m.data)}</td><td>${ROTULO_TIPO[m.tipo]}${m.estornadoPor ? " (ESTORNADO)" : ""}</td><td class="cod">${esc(m.codigo)}</td><td>${esc(m.descricao)}</td>
    <td class="num">${ehEntrada(m.tipo) ? "+" : "−"}${N.fmtQtd(m.quantidade)}</td><td class="num">${N.fmtCent(m.valorTotalCent)}</td>
    <td>${esc(m.setor)}</td><td>${esc(m.documento)}</td><td>${esc(m.usuarioNome || m.usuarioEmail)}</td></tr>`).join("")}</tbody></table>`);
};

/* ---------------------------------------------------------------- ESTORNO E CORREÇÃO DE MOVIMENTAÇÕES */
function acharMov(id) {
  for (const l of [S.movConsulta, S.recentes, S.doMes, fichaAtual?.movs || []]) { const m = l.find(x => x.id === id); if (m) return m; }
  return null;
}
async function aposAlterarMov() {
  if (S.movConsulta.length || S.vista === "movimentos") await consultarMovimentos();
  if ($("#dlg-kardex").open && fichaAtual) await abrirFicha(fichaAtual.p.id);
}
function resumoOriginal(m) {
  return `<b>${ROTULO_TIPO[m.tipo]}</b> de ${fmtData(m.data)} — <span class="mono">${esc(m.codigo)}</span> ${esc(m.descricao)}<br>
    Quantidade: <b>${ehEntrada(m.tipo) ? "+" : "−"}${N.fmtQtd(m.quantidade)} ${esc(m.unidade || "")}</b> · Valor: <b>${N.fmtCent(m.valorTotalCent)}</b><br>
    ${ehEntrada(m.tipo) ? "Fornecedor/origem" : "Setor/requisitante"}: ${esc(m.setor || "—")} · Documento: ${esc(m.documento || "—")} · Lançado por: ${esc(m.usuarioNome || m.usuarioEmail)}`;
}

let movEstorno = null;
document.addEventListener("click", e => {
  const b1 = e.target.closest("[data-estornar]"); if (b1) abrirEstorno(b1.dataset.estornar);
  const b2 = e.target.closest("[data-corrigir]"); if (b2) abrirCorrecao(b2.dataset.corrigir);
});

function abrirEstorno(id) {
  const m = acharMov(id); if (!m) return toast("Movimentação não encontrada. Recarregue a página.", true);
  movEstorno = m;
  const p = S.porId.get(m.produtoId);
  $("#de-original").innerHTML = resumoOriginal(m);
  $("#de-motivo").value = ""; $("#de-msg").textContent = "";
  let ok = true;
  try {
    if (!p) throw new Error("O produto desta movimentação foi excluído.");
    if (p.ativo === false) throw new Error("O produto está inativo. Reative-o em Produtos → Editar antes de estornar.");
    const r = N.aplicarEstorno({ quantidade: p.quantidade, valorTotalCent: p.valorTotalCent }, m.tipo, m.quantidade, m.valorTotalCent);
    $("#de-previa").innerHTML = `<b>Efeito do estorno (${ROTULO_TIPO[r.tipo]}):</b><br>
      Saldo: ${N.fmtQtd(p.quantidade)} → <b>${N.fmtQtd(r.novo.quantidade)}</b> ${esc(p.unidade)} ·
      Valor total: ${N.fmtCent(p.valorTotalCent)} → <b>${N.fmtCent(r.novo.valorTotalCent)}</b> · CMP: <b>${N.fmtUnit(r.custoMedio)}</b>
      ${r.diferencaCent ? `<br><span class="muted">O item será zerado; o valor baixado (${N.fmtCent(r.valorMovCent)}) difere do original em ${N.fmtCent(r.diferencaCent)} por efeito da média ponderada.</span>` : ""}`;
  } catch (e) { ok = false; $("#de-previa").innerHTML = `<span class="msg">${esc(e.message)}</span>`; }
  $("#de-confirmar").disabled = !ok;
  $("#dlg-estorno").showModal();
  if (ok) $("#de-motivo").focus();
}

$("#form-estorno").addEventListener("submit", async ev => {
  ev.preventDefault();
  const motivo = $("#de-motivo").value.trim(), msg = $("#de-msg"), m = movEstorno;
  if (motivo.length < 10) { msg.textContent = "Descreva a justificativa (mínimo 10 caracteres)."; return $("#de-motivo").focus(); }
  const btn = $("#de-confirmar"); btn.disabled = true; msg.textContent = "";
  try {
    const prodRef = doc(colProd, m.produtoId), origRef = doc(colMov, m.id), novoRef = doc(colMov);
    const r = await runTransaction(db, async tx => {
      const [ps, os] = await Promise.all([tx.get(prodRef), tx.get(origRef)]);
      if (!os.exists()) throw new Error("Movimentação original não encontrada.");
      const o = os.data();
      if (o.estornadoPor) throw new Error("Esta movimentação já foi estornada.");
      if (!ps.exists()) throw new Error("O produto desta movimentação foi excluído.");
      const p = ps.data();
      if (p.ativo === false) throw new Error("O produto está inativo. Reative-o antes de estornar.");
      const r = N.aplicarEstorno({ quantidade: p.quantidade, valorTotalCent: p.valorTotalCent }, o.tipo, o.quantidade, o.valorTotalCent);
      tx.set(novoRef, {
        ...montarMov(r.tipo, m.produtoId, p, r, r.novo, {
          setor: o.setor, documento: `Estorno de ${ROTULO_TIPO[o.tipo].toLowerCase()} de ${fmtDia(o.data)}${o.documento ? " — " + o.documento : ""}`, observacao: motivo,
        }),
        estornoDe: m.id, motivoEstorno: motivo,
      });
      tx.update(origRef, { estornadoPor: novoRef.id, estornadoEm: serverTimestamp(), estornadoPorEmail: S.email, motivoEstorno: motivo });
      tx.update(prodRef, {
        quantidade: r.novo.quantidade, valorTotalCent: r.novo.valorTotalCent, custoMedio: r.custoMedio,
        ultimoMovimentoId: novoRef.id, atualizadoEm: serverTimestamp(), atualizadoPor: S.email,
      });
      return r;
    });
    $("#dlg-estorno").close();
    toast(`Estorno registrado: ${ehEntrada(r.tipo) ? "+" : "−"}${N.fmtQtd(r.quantidade)}, ${N.fmtCent(r.valorMovCent)}. Estoque recalculado.`);
    await aposAlterarMov();
  } catch (e) { msg.textContent = msgErro(e); }
  finally { btn.disabled = false; }
});

$("#de-motivo").addEventListener("input", () => { $("#de-msg").textContent = ""; });

let movCorrecao = null;
function abrirCorrecao(id) {
  const m = acharMov(id); if (!m) return toast("Movimentação não encontrada. Recarregue a página.", true);
  movCorrecao = m;
  const fornecedor = m.tipo === "ENTRADA";
  $("#dc2-original").innerHTML = resumoOriginal(m);
  $("#dc2-setor-rot").firstChild.textContent = fornecedor ? "Fornecedor / origem" : "Setor / requisitante";
  $("#dc2-setor").setAttribute("list", fornecedor ? "lista-fornecedores" : "lista-setores");
  $("#dc2-setor").value = m.setor || ""; $("#dc2-doc").value = m.documento || ""; $("#dc2-obs").value = m.observacao || "";
  const hist = m.historico || [];
  $("#dc2-hist").innerHTML = hist.length ? `<div class="hist"><b>Correções anteriores</b>${hist.map(h => `<div>${new Date(h.em).toLocaleString("pt-BR")} — ${esc(h.nome || h.por)}: ${
    Object.entries(h.alteracoes || {}).map(([k, v]) => `${esc(k)} "${esc(v.de || "—")}" → "${esc(v.para || "—")}"`).join("; ")}</div>`).join("")}</div>` : "";
  $("#dc2-msg").textContent = "";
  $("#dlg-corrigir").showModal();
  $("#dc2-setor").focus();
}

$("#form-corrigir").addEventListener("submit", async ev => {
  ev.preventDefault();
  const m = movCorrecao, msg = $("#dc2-msg"); msg.textContent = "";
  const novos = { setor: $("#dc2-setor").value.trim(), documento: $("#dc2-doc").value.trim(), observacao: $("#dc2-obs").value.trim() };
  if (m.tipo === "SAIDA" && !novos.setor) return msg.textContent = "Retiradas precisam de setor/requisitante.";
  const btn = $("#dc2-salvar"); btn.disabled = true;
  try {
    const ref = doc(colMov, m.id);
    await runTransaction(db, async tx => {
      const s = await tx.get(ref); if (!s.exists()) throw new Error("Movimentação não encontrada.");
      const o = s.data(), alteracoes = {};
      for (const k of ["setor", "documento", "observacao"]) if ((o[k] || "") !== novos[k]) alteracoes[k] = { de: o[k] || "", para: novos[k] };
      if (!Object.keys(alteracoes).length) throw new Error("Nenhum dado foi alterado.");
      tx.update(ref, {
        ...novos, corrigidoEm: serverTimestamp(), corrigidoPor: S.email,
        historico: [...(o.historico || []), { em: new Date().toISOString(), por: S.email, nome: S.perfil?.nome || "", alteracoes }],
      });
    });
    $("#dlg-corrigir").close();
    toast("Dados da movimentação corrigidos. O histórico da alteração foi registrado.");
    await aposAlterarMov();
  } catch (e) { msg.textContent = msgErro(e); }
  finally { btn.disabled = false; }
});

/* ---------------------------------------------------------------- INVENTÁRIO */
function lerInv() { try { return JSON.parse(localStorage.getItem(INV_KEY)) || { cont: {}, base: {} }; } catch { return { cont: {}, base: {} }; } }
function gravarInv(inv) { try { localStorage.setItem(INV_KEY, JSON.stringify(inv)); } catch { /* armazenamento indisponível */ } }

function itensInventario() {
  const busca = N.normalizar($("#inv-busca").value), cat = $("#inv-categoria").value, inv = lerInv(), soDif = $("#inv-so-dif").checked;
  return S.produtos.filter(p => p.ativo !== false)
    .filter(p => (!cat || p.categoria === cat) && (!busca || N.normalizar(`${p.codigo} ${p.descricao} ${p.localizacao || ""}`).includes(busca)))
    .filter(p => !soDif || difInv(p, inv) !== null)
    .sort((a, b) => String(a.localizacao || "").localeCompare(String(b.localizacao || ""), "pt-BR") || a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
}
function difInv(p, inv) {
  const t = inv.cont[p.id]; if (t == null || t === "") return null;
  const c = N.lerNumeroBR(t); if (!(c >= 0)) return null;
  const base = inv.base[p.id] ?? p.quantidade, d = N.arredQtd(c - base);
  return d === 0 ? null : d;
}

function renderInventario() {
  if ($("#tab-inventario").contains(document.activeElement)) { S.invPendente = true; return; }
  S.invPendente = false;
  const inv = lerInv(), cego = $("#inv-cego").checked, lista = itensInventario();
  $("#tab-inventario").innerHTML = `<thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Localização</th>
    ${cego ? "" : `<th class="num">Saldo sistema</th>`}<th class="num">Quantidade contada</th>${cego ? "" : `<th class="num">Diferença</th><th class="num">Valor da diferença</th>`}</tr></thead>
    <tbody>${lista.map(p => `<tr data-id="${esc(p.id)}"><td class="cod">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade)}</td>
      <td class="pequeno">${esc(p.localizacao || "—")}</td>${cego ? "" : `<td class="num">${N.fmtQtd(inv.base[p.id] ?? p.quantidade)}</td>`}
      <td class="num"><input class="in-num in-cont" inputmode="decimal" value="${esc(inv.cont[p.id] ?? "")}" ${podeEscrever() ? "" : "disabled"}></td>
      ${cego ? "" : `<td class="num c-dif"></td><td class="num c-val"></td>`}</tr>`).join("") || `<tr><td colspan="8" class="vazio">Nenhum item.</td></tr>`}</tbody>`;
  $$("#tab-inventario tbody tr[data-id]").forEach(tr => {
    atualizarLinhaInv(tr, inv);
    const inp = tr.querySelector(".in-cont");
    inp.oninput = () => {
      const inv2 = lerInv(), id = tr.dataset.id, p = S.porId.get(id);
      if (inp.value.trim() === "") { delete inv2.cont[id]; delete inv2.base[id]; }
      else { inv2.cont[id] = inp.value; if (inv2.base[id] == null) inv2.base[id] = p.quantidade; }
      gravarInv(inv2); atualizarLinhaInv(tr, inv2); resumoInv();
    };
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); tr.nextElementSibling?.querySelector(".in-cont")?.focus(); } };
    inp.onblur = () => setTimeout(() => { if (S.invPendente && !$("#tab-inventario").contains(document.activeElement)) renderInventario(); }, 0);
  });
  resumoInv();
}
function atualizarLinhaInv(tr, inv) {
  const p = S.porId.get(tr.dataset.id), cd = tr.querySelector(".c-dif"), cv = tr.querySelector(".c-val");
  const inp = tr.querySelector(".in-cont"), t = inv.cont[p.id];
  inp.classList.toggle("erro", t != null && t !== "" && !(N.lerNumeroBR(t) >= 0));
  if (!cd) return;
  const d = difInv(p, inv);
  const cmp = p.quantidade > 0 ? p.valorTotalCent / p.quantidade / 100 : (p.ultimoCustoUnit || 0);
  cd.innerHTML = d === null ? "" : `<span class="${d > 0 ? "dif-pos" : "dif-neg"}">${d > 0 ? "+" : ""}${N.fmtQtd(d)}</span>`;
  cv.innerHTML = d === null ? "" : `<span class="${d > 0 ? "dif-pos" : "dif-neg"}">${N.fmtReais(d * cmp)}</span>`;
}
function resumoInv() {
  const inv = lerInv(), ativos = S.produtos.filter(p => p.ativo !== false);
  let contados = 0, dif = 0, sobra = 0, falta = 0;
  for (const p of ativos) {
    if (inv.cont[p.id] == null || inv.cont[p.id] === "") continue;
    contados++;
    const d = difInv(p, inv); if (d === null) continue;
    dif++;
    const cmp = p.quantidade > 0 ? p.valorTotalCent / p.quantidade / 100 : (p.ultimoCustoUnit || 0);
    if (d > 0) sobra += d * cmp; else falta += -d * cmp;
  }
  $("#inv-resumo").innerHTML = `<span>Contados: <b>${contados} de ${ativos.length}</b></span><span>Com diferença: <b>${dif}</b></span>
    <span>Sobras: <b class="dif-pos">${N.fmtReais(sobra)}</b></span><span>Faltas: <b class="dif-neg">${N.fmtReais(falta)}</b></span>`;
}
for (const id of ["#inv-busca", "#inv-categoria", "#inv-so-dif", "#inv-cego"]) $(id).addEventListener("input", renderInventario);

$("#btn-inv-limpar").onclick = async () => {
  if (await confirmar("Limpar rascunho", "<p>Apagar todas as contagens digitadas neste navegador?</p>", "Limpar")) { gravarInv({ cont: {}, base: {} }); renderInventario(); }
};
$("#btn-inv-folha").onclick = () => {
  const l = itensInventario(), cego = $("#inv-cego").checked;
  imprimir(`Folha de contagem física — ${new Date().toLocaleDateString("pt-BR")}`, `<table><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Localização</th>
    ${cego ? "" : `<th class="num">Saldo sistema</th>`}<th>1ª contagem</th><th>2ª contagem</th></tr></thead><tbody>
    ${l.map(p => `<tr><td class="cod">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade)}</td><td>${esc(p.localizacao || "")}</td>
    ${cego ? "" : `<td class="num">${N.fmtQtd(p.quantidade)}</td>`}<td><span class="linha">&nbsp;</span></td><td><span class="linha">&nbsp;</span></td></tr>`).join("")}</tbody></table>
    <div class="assin"><div>Contador(a)</div><div>Conferente</div><div>Responsável pelo almoxarifado</div></div>`);
};

$("#btn-inv-aplicar").onclick = async () => {
  const inv = lerInv();
  const ajustes = S.produtos.filter(p => p.ativo !== false).map(p => ({ p, d: difInv(p, inv) })).filter(x => x.d !== null);
  if (!ajustes.length) return toast("Nenhuma diferença a ajustar.");
  if (!await confirmar("Aplicar ajustes de inventário", `<p>Serão lançados <b>${ajustes.length}</b> ajustes (sobras e faltas), valorizados pelo custo médio vigente.</p>
    <p class="muted">Itens movimentados depois do início da contagem serão ignorados e sinalizados para recontagem.</p>`, "Aplicar ajustes")) return;
  const docInv = `Inventário ${new Date().toLocaleDateString("pt-BR")}`, loteId = doc(colMov).id;
  let ok = 0; const conflitos = [], falhas = [];
  for (const { p } of ajustes) {
    try {
      await runTransaction(db, async tx => {
        const ref = doc(colProd, p.id), s = await tx.get(ref);
        const atual = s.data();
        if (Math.abs(atual.quantidade - (inv.base[p.id] ?? p.quantidade)) > 1e-9) throw { code: "conflito" };
        const r = N.aplicarAjuste({ quantidade: atual.quantidade, valorTotalCent: atual.valorTotalCent }, N.lerNumeroBR(inv.cont[p.id]), atual.ultimoCustoUnit || 0);
        if (!r) return;
        const movRef = doc(colMov);
        tx.set(movRef, montarMov(r.tipo, p.id, atual, r, r.novo, { documento: docInv, setor: "Inventário físico", observacao: `Contado: ${inv.cont[p.id]}` }, loteId));
        tx.update(ref, { quantidade: r.novo.quantidade, valorTotalCent: r.novo.valorTotalCent, custoMedio: r.custoMedio, ultimoMovimentoId: movRef.id, atualizadoEm: serverTimestamp(), atualizadoPor: S.email });
      });
      ok++; delete inv.cont[p.id]; delete inv.base[p.id];
    } catch (e) { (e.code === "conflito" ? conflitos : falhas).push(p.codigo + (e.code === "conflito" ? "" : `: ${msgErro(e)}`)); }
  }
  // remove do rascunho os itens contados sem diferença
  for (const id of Object.keys(inv.cont)) { const p = S.porId.get(id); if (p && difInv(p, inv) === null && !conflitos.includes(p.codigo)) { delete inv.cont[id]; delete inv.base[id]; } }
  for (const c of conflitos) { const id = N.idDoCodigo(c); delete inv.cont[id]; delete inv.base[id]; }
  gravarInv(inv); renderInventario();
  toast(`${ok} ajuste(s) aplicado(s).`);
  if (conflitos.length) toast(`Recontar (movimentados durante a contagem): ${conflitos.join(", ")}`, true);
  if (falhas.length) toast(`Falhas: ${falhas.join("; ")}`, true);
};

/* ---------------------------------------------------------------- USUÁRIOS */
function renderUsuarios() {
  const l = [...S.usuarios].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  $("#tab-usuarios").innerHTML = `<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Autorizado em</th><th class="acts"></th></tr></thead>
    <tbody>${l.map(u => {
      const eu = u.id === S.email;
      return `<tr class="${u.ativo ? "" : "inativo"}"><td><b>${esc(u.nome)}</b>${eu ? ` <span class="muted pequeno">(você)</span>` : ""}</td>
      <td class="mono">${esc(u.id)}</td>
      <td><select data-papel="${esc(u.id)}" ${eu ? "disabled" : ""}>${Object.entries(ROTULO_PAPEL).map(([k, v]) => `<option value="${k}"${u.papel === k ? " selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><span class="etq etq-${u.ativo ? "ok" : "inativo"}">${u.ativo ? "Ativo" : "Bloqueado"}</span></td>
      <td class="pequeno">${fmtDia(u.criadoEm)}${u.criadoPor ? ` · ${esc(u.criadoPor)}` : ""}</td>
      <td class="acts">${eu ? "" : `<button class="btn btn-mini" data-ativo="${esc(u.id)}">${u.ativo ? "Bloquear" : "Reativar"}</button>
        <button class="btn btn-mini" data-rm-u="${esc(u.id)}">Remover</button>`}</td></tr>`;
    }).join("")}</tbody>`;
  $$("#tab-usuarios [data-papel]").forEach(s => s.onchange = () => updateDoc(doc(colUsu, s.dataset.papel), { papel: s.value, atualizadoEm: serverTimestamp(), atualizadoPor: S.email })
    .then(() => toast("Perfil alterado.")).catch(e => toast(msgErro(e), true)));
  $$("#tab-usuarios [data-ativo]").forEach(b => b.onclick = () => {
    const u = S.usuarios.find(x => x.id === b.dataset.ativo);
    updateDoc(doc(colUsu, u.id), { ativo: !u.ativo, atualizadoEm: serverTimestamp(), atualizadoPor: S.email }).catch(e => toast(msgErro(e), true));
  });
  $$("#tab-usuarios [data-rm-u]").forEach(b => b.onclick = async () => {
    if (await confirmar("Remover usuário", `<p>Remover o acesso de <b>${esc(b.dataset.rmU)}</b>?</p>`, "Remover"))
      deleteDoc(doc(colUsu, b.dataset.rmU)).then(() => toast("Usuário removido.")).catch(e => toast(msgErro(e), true));
  });
}

$("#form-usuario").onsubmit = async ev => {
  ev.preventDefault();
  const email = emailNorm($("#u-email").value), nome = $("#u-nome").value.trim(), papel = $("#u-papel").value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("E-mail inválido.", true);
  if (!nome) return toast("Informe o nome.", true);
  if (email === S.email) return toast("Você não pode alterar o próprio cadastro por aqui.", true);
  const existe = S.usuarios.some(u => u.id === email);
  try {
    await setDoc(doc(colUsu, email), existe
      ? { nome, papel, ativo: true, atualizadoEm: serverTimestamp(), atualizadoPor: S.email }
      : { nome, papel, ativo: true, criadoEm: serverTimestamp(), criadoPor: S.email }, { merge: true });
    toast(existe ? "Usuário atualizado." : "Usuário autorizado. Ele já pode entrar com este e-mail.");
    ev.target.reset();
  } catch (e) { toast(msgErro(e), true); }
};

/* ---------------------------------------------------------------- Início */
preencherInstitucional();
$$("[data-fechar]").forEach(b => b.onclick = () => b.closest("dialog").close());
// Enter nos itens do lançamento avança o campo (não confirma por engano)
$("#form-lanc").addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  e.preventDefault();
  if (!$("#tab-lanc").contains(e.target)) return;
  const campos = $$("#tab-lanc input"), i = campos.indexOf(e.target);
  if (i === campos.length - 1) addItemLanc(); else campos[i + 1].focus();
  if (i === campos.length - 1) $$("#tab-lanc .in-prod").at(-1)?.focus();
});
if (!CONFIG_OK) {
  bloquear("Configuração pendente", "Edite o arquivo <code>js/config.js</code> e cole as credenciais do seu projeto Firebase (veja o README).");
  $("#btn-sair-bloq").hidden = true;
}
