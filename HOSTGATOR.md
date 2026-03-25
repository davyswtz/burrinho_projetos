# Deploy na HostGator — Burrinho Projetos

Guia para publicar o painel com **PHP + MySQL** (cPanel), com dados compartilhados entre todos os usuários que acessam o mesmo site.

## 1. Banco de dados MySQL

1. No **cPanel**, abra **MySQL® Databases**.
2. Crie um banco (ex.: `usuario_burrinho`) e um usuário com senha forte.
3. **Associe** o usuário ao banco com **Todos os privilégios**.
4. Abra **phpMyAdmin**, selecione o banco e vá em **Importar**.
5. Envie o arquivo **`api/schema.sql`** e execute (ou cole o SQL na aba SQL).  
   O schema também cria a tabela de autenticação **`usuario`** e já insere os usuários padrão do painel.

Se você já tinha uma versão antiga só com parte das colunas de `op_tasks`, rode também **`api/migrations/001_op_tasks_rompimento_fields.sql`** (se der erro de coluna duplicada, pode ignorar).

## 2. Credenciais da API

1. Na pasta **`api/`**, copie o arquivo:

   `credentials.example.php` → **`credentials.php`**

2. Edite **`credentials.php`** com host, nome do banco, usuário e senha do cPanel.  
   Em muitos planos o host é **`localhost`**; em alguns aparece algo como **`mysql.seudominio.com`** na própria tela do cPanel — use exatamente o que eles indicam.

O arquivo **`api/.htaccess`** bloqueia acesso direto por URL a **`credentials.php`** (camada extra de proteção).

## 3. Envio dos arquivos

Estrutura típica no **`public_html`** (ou subpasta do domínio):

```text
public_html/
├── index.html
├── src/
│   ├── css/
│   ├── data/
│   │   ├── ipatinga_cto.json
│   │   └── governadorvaladares_cto.json  (e outros JSON de CTO, se houver)
│   └── js/
│       ├── main.js
│       ├── config.example.js
│       └── config.js              ← opcional: cópia local (não commitar segredos)
└── api/
    ├── .htaccess
    ├── db.php
    ├── credentials.php      ← você criou (não vem no repositório)
    ├── credentials.example.php
    ├── bootstrap.php
    ├── tasks.php
    ├── op_tasks.php
    ├── calendar_notes.php
    ├── config.php
    └── schema.sql           ← opcional manter só como backup; não precisa expor
```

- Não é obrigatório enviar **`api/migrations/`** para produção, mas não atrapalha.
- Arquivos **`api/*.js`** (Vercel) e **`vercel.json`** podem ficar no FTP; a HostGator simplesmente os ignora se não forem chamados.

## 4. PHP

A HostGator costuma usar **PHP 8.x**. No cPanel, em **Select PHP Version**, prefira **8.1 ou 8.2**.

## 5. Front-end e URL da API

O **`main.js`** monta a base da API como **`https://seudominio.com/api`** (mesmo domínio + pasta **`api`**).

- Se o site estiver na **raiz** do domínio, nada a configurar.
- Se estiver em **subpasta** (`https://dominio.com/pasta/`), a API será **`https://dominio.com/pasta/api`** automaticamente.
- Só use configuração manual se a API estiver em **outro subdomínio**; aí inclua antes do `main.js`:

```html
<script>
  window.APP_CONFIG = { apiBaseUrl: 'https://api.seudominio.com/api' };
</script>
```

### JSON de CTO (cadastro rompimento)

O front-end carrega **`src/data/*.json`**. Envie a pasta **`src/data/`** completa no FTP, na mesma hierarquia relativa a `index.html`.  
Se o JSON estiver em outro caminho absoluto (CDN ou subpasta diferente), defina em `config.js` a chave **`ctoDataBase`** (URL da pasta terminando em `/`, apontando para onde estão os `.json`).

## 6. Arquivo `config.js` (opcional)

Copie **`src/js/config.example.js`** → **`src/js/config.js`** e, em **`index.html`**, carregue **antes** de `main.js`:

```html
<script src="./src/js/config.js"></script>
<script src="./src/js/main.js"></script>
```

Chaves úteis de `window.APP_CONFIG`:

| Chave | Uso |
|--------|-----|
| `apiBaseUrl` | Base da API PHP (já documentada acima). |
| `defaultWebhookUrl` | Webhook Google Chat padrão (só se quiser pré-preencher; usuário ainda pode trocar no modal). |
| `ctoDataBase` | Pasta base dos JSON de CTO, se não forem servidos em `src/data/` relativo ao site. |
| `authUsers` | Array `{ user, pass }` para login; sem isso o app usa credenciais de demonstração internas. |

Não versionar **`config.js`** com URLs ou senhas reais em repositório público.

## 7. Teste rápido

1. No navegador: `https://seudominio.com/api/bootstrap.php`  
   Deve retornar **JSON** com `"ok": true` e listas (podem estar vazias).
2. Se aparecer erro de banco, confira **`credentials.php`** e se o **`schema.sql`** foi importado.
3. Faça login no painel, crie uma tarefa e atualize a página — o dado deve persistir.

## 8. Segurança (recomendado)

- Login padrão no front é **demonstração** (`projetos` / `123`). Em produção, prefira **`authUsers`** em `config.js` (ainda é front-end; para dados sensíveis, evolua para auth no servidor).
- **Webhook Google Chat:** não commitar URL com `key`/token no repositório. Use o modal do app ou `defaultWebhookUrl` só em deploy fechado. Se uma URL já vazou no histórico do Git, **revogue/regenere o webhook** no Google Chat e use uma URL nova.
- Force **HTTPS** no cPanel (**SSL/TLS**) e, se quiser, redirecionamento HTTP → HTTPS.

## 9. Suporte HostGator

Limites de PHP (timeout, upload) e versão do MySQL variam por plano. Em erro **500**, verifique **Errors** no cPanel ou ative log de erros PHP temporariamente.

---

**Resumo:** importar **`schema.sql`** → criar **`api/credentials.php`** → enviar arquivos (**incluindo `src/data/`**) → opcional **`config.js`** → testar **`bootstrap.php`**.
