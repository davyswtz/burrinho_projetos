/**
 * Copie para `config.js` na mesma pasta e ajuste (não versionar `config.js` com segredos).
 * Em `index.html`, antes de `main.js`:
 *   <script src="./src/js/config.js"></script>
 *
 * @typedef {{ user: string, pass: string }} AuthUser
 * @typedef {{
 *   apiBaseUrl?: string|false,
 *   defaultWebhookUrl?: string,
 *   ctoDataBase?: string,
 *   authUsers?: AuthUser[],
 * }} AppConfig
 */
window.APP_CONFIG = {
  apiBaseUrl: '',

  /** URL do webhook Google Chat (só para ambiente fechado; em geral configure pelo modal do app). */
  // defaultWebhookUrl: 'https://chat.googleapis.com/v1/spaces/...',

  /**
   * Pasta base dos JSON de CTO (termina com /). Ex.: `https://meusite.com/burrinho/src/data/`
   * Só necessário se os arquivos não estiverem relativos ao `main.js`.
   */
  // ctoDataBase: 'https://meusite.com/subpasta/src/data/',

  /** Credenciais de login (fallback apenas quando API remota estiver desabilitada). */
  // authUsers: [{ user: 'nome', pass: 'senha-segura' }],
};
