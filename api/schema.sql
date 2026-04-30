-- ═══════════════════════════════════════════════════════════════════════════
-- Burrinho Projetos — schema MySQL 8.x / MariaDB 10.3+ (HostGator / cPanel)
-- Charset: utf8mb4 (acentuação e símbolos nas notificações)
-- Execute no phpMyAdmin ou: mysql -u USUARIO -p NOME_DB < schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── Tarefas gerais (Dashboard) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id INT NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  responsavel VARCHAR(120) NOT NULL,
  prazo DATE NULL,
  status VARCHAR(48) NOT NULL DEFAULT 'Pendente',
  prioridade VARCHAR(24) NOT NULL DEFAULT 'Média',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tasks_prazo (prazo),
  KEY idx_tasks_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Tarefas operacionais (Rompimentos, Troca de poste, Atendimento) ──────
CREATE TABLE IF NOT EXISTS op_tasks (
  id INT NOT NULL,
  taskCode VARCHAR(32) NOT NULL,
  titulo VARCHAR(500) NOT NULL,
  setor VARCHAR(180) NOT NULL DEFAULT '',
  regiao VARCHAR(64) NOT NULL DEFAULT '',
  responsavel VARCHAR(120) NOT NULL,
  clientesAfetados VARCHAR(32) NOT NULL DEFAULT '',
  coordenadas VARCHAR(120) NOT NULL DEFAULT '',
  localizacao_texto VARCHAR(512) NOT NULL DEFAULT '',
  descricao MEDIUMTEXT,
  categoria VARCHAR(48) NOT NULL,
  prazo DATE NULL,
  prioridade VARCHAR(24) NOT NULL DEFAULT 'Média',
  status VARCHAR(48) NOT NULL DEFAULT 'Criada',
  is_parent_task TINYINT(1) NOT NULL DEFAULT 0,
  parent_task_id INT NULL,
  criadaEm VARCHAR(64) NOT NULL DEFAULT '',
  historico LONGTEXT,
  chat_thread_key VARCHAR(140) NOT NULL DEFAULT '',
  nome_cliente VARCHAR(255) NOT NULL DEFAULT '',
  protocolo VARCHAR(180) NOT NULL DEFAULT '',
  data_entrada VARCHAR(64) NOT NULL DEFAULT '',
  data_instalacao VARCHAR(64) NOT NULL DEFAULT '',
  assinada_por VARCHAR(120) NOT NULL DEFAULT '',
  assinada_em VARCHAR(64) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_op_tasks_categoria (categoria),
  KEY idx_op_tasks_status (status),
  KEY idx_op_tasks_parent (parent_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Imagens embutidas na descrição (op_tasks) ─────────────────────────────
CREATE TABLE IF NOT EXISTS op_task_image (
  id INT NOT NULL AUTO_INCREMENT,
  op_task_id INT NOT NULL,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'image/png',
  image_data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_op_task_image_task (op_task_id),
  CONSTRAINT fk_op_task_image_op_task FOREIGN KEY (op_task_id) REFERENCES op_tasks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Configuração (webhook Google Chat, nota do planner) ───────────────────
CREATE TABLE IF NOT EXISTS app_config (
  cfg_key VARCHAR(64) NOT NULL,
  cfg_value LONGTEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cfg_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notificações do sistema (sininho) ─────────────────────────────────────
-- "Não lido" é controlado no front por lastSeenId por usuário (localStorage).
CREATE TABLE IF NOT EXISTS app_notification (
  id BIGINT NOT NULL AUTO_INCREMENT,
  kind VARCHAR(48) NOT NULL DEFAULT 'task_added',
  title VARCHAR(255) NOT NULL DEFAULT '',
  message VARCHAR(600) NOT NULL DEFAULT '',
  ref_type VARCHAR(32) NOT NULL DEFAULT '',  -- 'task' | 'op_task'
  ref_id INT NULL,
  op_category VARCHAR(48) NOT NULL DEFAULT '',
  created_by VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_app_notification_created (created_at),
  KEY idx_app_notification_updated (updated_at),
  KEY idx_app_notification_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Atividade recente do usuário (audit leve) ─────────────────────────────
-- Feed do dashboard: eventos do usuário logado (criou/alterou status etc.).
CREATE TABLE IF NOT EXISTS app_activity_event (
  id BIGINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(120) NOT NULL,
  event_type VARCHAR(48) NOT NULL,          -- task_created | op_task_created | op_status_changed | task_updated ...
  severity VARCHAR(16) NOT NULL DEFAULT 'info', -- info|success|warning|danger
  message VARCHAR(600) NOT NULL DEFAULT '',
  ref_type VARCHAR(32) NOT NULL DEFAULT '', -- task|op_task
  ref_id INT NULL,
  op_category VARCHAR(48) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_user_created (username, created_at),
  KEY idx_activity_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Chat interno da equipe (polling no front; sem WebSocket) ─────────────
CREATE TABLE IF NOT EXISTS team_chat_message (
  id BIGINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(120) NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_team_chat_message_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Usuários (login do painel) ─────────────────────────────────────────
-- Senhas armazenadas como PBKDF2 (sha256) com salt por usuário.
CREATE TABLE IF NOT EXISTS usuario (
  username VARCHAR(120) NOT NULL,
  pass_salt VARCHAR(64) NOT NULL,
  pass_hash VARCHAR(64) NOT NULL,
  pass_iterations INT NOT NULL DEFAULT 60000,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed de usuários (PBKDF2 60k iterações — mais leve em hospedagem compartilhada que 200k)
INSERT INTO usuario (username, pass_salt, pass_hash, pass_iterations) VALUES
  ('matheusibipar', 'd4bdc0204af1eb1f1c479b73cac44aa8', '49f5a799a7b3b19967ea4faa744c36f1ebf26789a029886194a42c3304ee25dd', 60000),
  ('nathibipar', '386d75af527d5e3c4809312e99ec4e45', '7be6440364607e51e009b395c27365f1460c635cf4d81ca7fb9ca4e5661fb326', 60000),
  ('davyibipar', '955523a4155ff19d972b552b332b843d', 'b794bdd43d48443d21bcf917cfd2b948d59ca55c1a9d5f65e448f07cd6e8c8e4', 60000),
  ('joaoibipar', '1caa710951958623cfc9bffb426085c9', '0faa8561980a45d6dfa1a8b53c95f12a924270a06e591f80ebbb5d9d70a481d4', 60000),
  ('danielaibipar', '53d858ff60f593d3bda7e4075b3386a3', '8a5fa588f839f73d1c4c84bac21b1cf2771bd6299f7f1bfdb3c8b83a329ff22d', 60000),
  ('marcosibipar', '44a7c0fcd4fe5864ce6a78d0d3a82d04', '3b260c64a81fadf7782f63e81653a5b76a3ff41b812dd4a1204af38624551ef2', 60000),
  ('jobertibipar', 'eeaafc242a2210ec94259cee2c6a37ac', 'f106e6808827dc47034e48e04ed29d2abc99e1593c8b55b06f570762b47e566e', 60000),
  ('ederibipar', '4d21f7ce24bbb4267a5323cd1e48c60b', 'a60703a78acede2b2177a5f1d23856614dfe9704c7bed4612a67ef3a0e5e1467', 60000),
  ('mauricioibipar', '9e4be252661f4bff94bc4eea3c41e022', '5131a3544c1faaa341baa1d9f270fed8bffac6b8f89cc4f8bfcbdf79edc3cb56', 60000),
  ('joaopdr', '405730225804403437fc648d9b01af4c', '16c63a634ddc92a18c65f48dd7538228366d48de47ac1940d67094ef175592e1', 60000)
ON DUPLICATE KEY UPDATE
  pass_salt = VALUES(pass_salt),
  pass_hash = VALUES(pass_hash),
  pass_iterations = VALUES(pass_iterations);

SET FOREIGN_KEY_CHECKS = 1;
