// Config local (não versionar com tokens reais, se possível).
// apiBaseUrl: em produzão costuma ser auto (mesmo host + pasta do app + /api). Defina manual se precisar.
(function () {
  const prev = (typeof window !== 'undefined' && window.APP_CONFIG) ? window.APP_CONFIG : {};

  window.APP_CONFIG = {
    ...prev,
    // Webhooks por região (Google Chat).
    // IMPORTANTE: URLs com token são sensíveis. Evite commitar em repositório público.
    defaultWebhookUrlsByRegion: {
      GOVAL: 'https://chat.googleapis.com/v1/spaces/AAQAALsNEnY/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=zOzkVRXR_IpFq180r_0RGs38Nijutd44TrH9Vpj1Qgo',
      VALE_DO_ACO: 'https://chat.googleapis.com/v1/spaces/AAQAXZP72GA/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=H0xwX2gBWHgfN2YmxaNGFTtLt_MG1-HEdlVPpmFHlUc',
      CARATINGA: 'https://chat.googleapis.com/v1/spaces/AAQArIWN3jM/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=eFDHTyVmz4f1AsxpJzxSPVC8TI0nOP0VSGOaK_bpowI',
      BACKUP: 'https://chat.googleapis.com/v1/spaces/AAQAgqsNKYg/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=03UNaWYGsXuzDGcs-ascMurXLVsbxThfdDjda7taoDk',
    },

    // Diretório de técnicos para autocomplete + menções no Chat.
    // `chatUserId`: pode ser um número (ex.: "123456789") ou o resource name (ex.: "users/123456789").
    techsByRegion: {
      GOVAL: [
        { name: 'Diogo', chatUserId: '108550026877105275192' },
        { name: 'Leyzon', chatUserId: '106401946499967744380' },
        { name: 'Tiago', chatUserId: '101380783980574935265' },
        { name: 'Matheus Leite', chatUserId: '108878826481798176302' },
        { name: 'Lucas', chatUserId: '104890974179693995001' },
        { name: 'Isak', chatUserId: '108767000765958552234' },
        { name: 'Guilherme', chatUserId: '110674011987336259927' },
        { name: 'Gabriel Cantão', chatUserId: '108676605328960824173' },
      ],
      VALE_DO_ACO: [
        { name: 'Carlos', chatUserId: '116570300630830665670' },
        { name: 'Wallison', chatUserId: '108816543518917361378' },
        { name: 'Messias', chatUserId: '107729755364477461933' },
        { name: 'Roberto Kallyl', chatUserId: '116868701156027259229' },
        { name: 'Kallyl', chatUserId: '116868701156027259229' },
        { name: 'Arrhenius', chatUserId: '104672635607071026724' },
        { name: 'Thales', chatUserId: '114670511005082185491' },
        { name: 'Weignon', chatUserId: '102567325876582077098' },
        { name: 'Eduardo', chatUserId: '113773984468601459304' },
        { name: 'Hugo', chatUserId: '112666079684600011906' },
        { name: 'Reginaldo', chatUserId: '106260606388411799911' },
      ],
      // CARATINGA: [ { name: '...', chatUserId: '...' } ],
    },

    /** Base da API PHP (bootstrap, login, tarefas…). '' = auto na hospedagem; false = desliga API remota. */
    apiBaseUrl: Object.prototype.hasOwnProperty.call(prev, 'apiBaseUrl') ? prev.apiBaseUrl : '',
  };
})();

