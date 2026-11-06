# Controle de Estoque — IBRAM-DF

Sistema web de controle de estoque/almoxarifado com valoração pelo **custo médio ponderado móvel** (Lei nº 4.320/1964, art. 106, III), hospedado no **GitHub Pages** e com dados no **Firebase (Authentication + Cloud Firestore)**. Não exige servidor próprio nem instalação: é um site estático.

---

## 1. Funcionalidades

| Módulo | O que faz |
|---|---|
| **Painel** | Valor total em estoque, itens a repor, retiradas e entradas do mês, curva ABC e últimas movimentações — tudo em tempo real. |
| **Produtos** | Código, descrição, unidade, quantidade, valor unitário (custo médio), valor total, estoque mínimo, categoria e localização. Busca instantânea (atalho `/`), filtros, ordenação, exportação CSV, impressão e importação em lote. |
| **Entrada / Retirada** | Lançamento de até 8 itens por vez (uma requisição ou uma nota fiscal), com **prévia do recálculo** antes de confirmar e bloqueio de saldo insuficiente. Gera comprovante de retirada para assinatura. |
| **Movimentações** | Trilha de auditoria imutável (ninguém edita nem apaga), com filtro por período, tipo e texto; exportação CSV e impressão. |
| **Ficha do produto** | Kardex: cada entrada/saída com saldo físico, saldo financeiro e custo médio após o lançamento. |
| **Inventário** | Contagem física (inclusive às cegas), cálculo de sobras/faltas, folha de contagem impressa e lançamento automático dos ajustes. Detecta itens movimentados durante a contagem e pede recontagem. |
| **Usuários** | O administrador define quem pode entrar e com qual perfil. |

### Perfis de acesso

| Perfil | Consulta | Cadastra / movimenta / inventaria | Gerencia usuários | Exclui produto |
|---|:-:|:-:|:-:|:-:|
| Consulta | ✔ | | | |
| Operador | ✔ | ✔ | | |
| Administrador | ✔ | ✔ | ✔ | ✔ (inativo e zerado) |

---

## 2. Regra de cálculo (custo médio ponderado móvel)

Valores são guardados em **centavos inteiros** para eliminar erro de arredondamento na soma do estoque.

- **Entrada:** `Valor total novo = Valor total anterior + Qtd × Valor unitário` → `CMP = Valor total / Quantidade`
- **Retirada:** `Valor da saída = Qtd × Valor total / Quantidade` (pelo CMP vigente). Se a retirada zera o item, baixa-se o valor total remanescente (o estoque nunca fica com "centavos fantasmas").
- **Ajuste de inventário:** sobra = entrada pelo CMP vigente; falta = saída pelo CMP vigente.

**Exemplo** (Papel A4):

| Lançamento | Qtd | Valor do lançamento | Saldo | Valor total | CMP |
|---|--:|--:|--:|--:|--:|
| Saldo inicial 100 × R$ 25,50 | +100 | R$ 2.550,00 | 100 | R$ 2.550,00 | R$ 25,50 |
| Entrada NF 50 × R$ 27,00 | +50 | R$ 1.350,00 | 150 | R$ 3.900,00 | R$ 26,00 |
| Retirada | −40 | 40 × 26,00 = R$ 1.040,00 | 110 | R$ 2.860,00 | R$ 26,00 |
| Inventário (contado 108) | −2 | R$ 52,00 | 108 | R$ 2.808,00 | R$ 26,00 |

---

## 3. Implantação passo a passo

### 3.1 Criar o projeto no Firebase
1. Acesse <https://console.firebase.google.com> → **Adicionar projeto** (ex.: `estoque-ibram`). O Google Analytics pode ser desativado.
2. **Build → Firestore Database → Criar banco de dados** → modo **produção** → local `southamerica-east1 (São Paulo)`.
3. **Build → Authentication → Começar** → aba **Método de login**:
   - habilite **Google**;
   - habilite **E-mail/senha** (se for usar contas institucionais que não são Google).
4. **Configurações do projeto (engrenagem) → Seus apps → Web `</>`** → registre o app → copie o objeto `firebaseConfig`.

### 3.2 Configurar o código
Abra `js/config.js` e substitua o bloco `firebaseConfig` pelo copiado. Ajuste, se quiser, os textos de `INSTITUICAO`.

> A `apiKey` do Firebase **não é senha** e pode ficar pública no GitHub. A segurança está nas regras do Firestore (passo 3.3) e na lista de usuários autorizados.

### 3.3 Publicar as regras de segurança
**Firestore Database → Regras** → apague o conteúdo, cole o arquivo `firestore.rules` inteiro → **Publicar**.

### 3.4 Cadastrar o primeiro administrador (uma única vez)
As regras não permitem que alguém se autorize sozinho; por isso o primeiro admin é criado no console:

1. **Firestore Database → Dados → Iniciar coleção** → ID da coleção: `usuarios`
2. **ID do documento:** seu e-mail **todo em minúsculas** (ex.: `fulano@ibram.df.gov.br`)
3. Campos:

| Campo | Tipo | Valor |
|---|---|---|
| `nome` | string | Seu nome completo |
| `papel` | string | `admin` |
| `ativo` | boolean | `true` |

Depois disso, todos os demais usuários são autorizados pela tela **Usuários** do próprio sistema.

### 3.5 Publicar no GitHub Pages
1. Crie um repositório (ex.: `estoque-ibram`) em <https://github.com/new>.
2. **Add file → Upload files** → arraste **todo o conteúdo** da pasta (`index.html`, `css/`, `js/`, `assets/`, etc.) → **Commit changes**.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. Em 1–2 minutos o site estará em `https://SEU-USUARIO.github.io/estoque-ibram/`.

### 3.6 Autorizar o domínio no Firebase (obrigatório)
**Authentication → Configurações → Domínios autorizados → Adicionar domínio** → `SEU-USUARIO.github.io`.
Sem isso o login retorna "Domínio não autorizado".

---

## 4. Como os usuários entram

- **Conta Google:** botão "Entrar com Google".
- **E-mail e senha:** na primeira vez, o usuário digita o e-mail autorizado, cria uma senha e clica em **Primeiro acesso**. O sistema envia um link de verificação; só após confirmar o e-mail o acesso é liberado (isso impede que alguém crie conta com o e-mail de outra pessoa).
- Quem não estiver na lista vê "Acesso não autorizado". Para revogar acesso, o admin clica em **Bloquear** ou **Remover** — o efeito é imediato.

---

## 5. Importação em lote (planilha)

Use `modelo-importacao.csv` (abre no Excel). Colunas: `codigo; descricao; unidade; quantidade; valor_unitario; categoria; estoque_minimo; localizacao`. Somente `codigo` e `descricao` são obrigatórias. Números no formato brasileiro (`1.234,56`). Códigos já existentes são ignorados e listados antes da confirmação. Cada linha gera um lançamento de **saldo inicial**.

No Excel: **Arquivo → Salvar como → CSV UTF-8 (delimitado por vírgulas)** — o sistema aceita `;` ou `,`.

---

## 6. Estrutura dos arquivos

```
index.html               Página única do sistema
css/estilo.css           Identidade visual (Source Serif 4 / IBM Plex Sans / IBM Plex Mono)
js/config.js             ← ÚNICO arquivo a editar (credenciais Firebase e textos)
js/nucleo.js             Regras de cálculo (CMP, ajustes, curva ABC, CSV) — sem dependências
js/app.js                Interface, autenticação e gravação no Firestore
assets/logo.png          Logotipo Brasília Ambiental
firestore.rules          Regras de segurança do banco
modelo-importacao.csv    Modelo de planilha para carga inicial
tests/nucleo.test.mjs    Testes automatizados do cálculo (node tests/nucleo.test.mjs)
```

### Coleções no Firestore
- `usuarios/{email}` — `nome`, `papel`, `ativo`
- `produtos/{código}` — dados cadastrais + `quantidade`, `valorTotalCent`, `custoMedio`, `ultimoMovimentoId`
- `movimentos/{id}` — tipo, quantidade, valores, saldo após, setor, documento, usuário, data do servidor

Cada alteração de saldo é feita em **transação**: produto e movimentação são gravados juntos ou nenhum dos dois. As regras exigem esse vínculo, então nem mesmo um operador mal-intencionado consegue alterar saldo sem deixar registro.

---

## 7. Limites e observações

- **Custo:** o plano gratuito (Spark) do Firebase atende com folga um almoxarifado típico (50 mil leituras e 20 mil gravações por dia).
- **Até 8 itens por lançamento** — limite das regras de segurança do Firestore (20 verificações de documento por transação). Para mais itens, faça dois lançamentos com o mesmo nº de documento.
- O rascunho do inventário fica no navegador onde foi digitado; use sempre o mesmo computador até aplicar os ajustes.
- Exclusão de produto só é permitida a administrador, com o item inativo e zerado; o histórico é preservado.
- O logotipo foi extraído da captura de tela; para máxima nitidez, substitua `assets/logo.png` pelo arquivo original em alta resolução (mesmo nome).
