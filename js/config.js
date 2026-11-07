/* ==========================================================================
   CONFIGURAÇÃO — edite APENAS este arquivo para implantar o sistema.
   --------------------------------------------------------------------------
   1) Firebase Console → Configurações do projeto → Seus apps → app Web (</>)
      → copie o objeto firebaseConfig e cole abaixo.
   2) A apiKey do Firebase NÃO é segredo: a proteção dos dados é feita pelas
      regras do Firestore (arquivo firestore.rules) e pela lista de usuários
      autorizados. Pode publicar este arquivo no GitHub.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: "AIzaSyDe1Zo4pP5v6bb6_i4VvW12MoBCxr2K_sE",
  authDomain: "portal-estoque-material.firebaseapp.com",
  projectId: "portal-estoque-material",
  storageBucket: "portal-estoque-material.firebasestorage.app",
  messagingSenderId: "672345030723",
  appId: "1:672345030723:web:f4ee9220905c9c645414f6"
};

/* Textos institucionais exibidos na interface e nos relatórios impressos. */
export const INSTITUICAO = {
  sigla: "IBRAM-DF",
  unidade: "DIGEP — IBRAM-DF",
  sistema: "Controle de Estoque",
  nomeCompleto: "Instituto do Meio Ambiente e dos Recursos Hídricos do Distrito Federal — Brasília Ambiental",
};

/* Métodos de login habilitados (ative os mesmos no Firebase Authentication). */
export const LOGIN = {
  google: true,        // Conta Google (inclui Google Workspace)
  emailSenha: true,    // E-mail e senha (exige verificação do e-mail)
};

/* Limite de itens por requisição/nota (restrição das regras do Firestore). */
export const MAX_ITENS_POR_LANCAMENTO = 8;
