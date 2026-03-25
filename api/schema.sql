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
  descricao TEXT,
  categoria VARCHAR(48) NOT NULL,
  prazo DATE NULL,
  prioridade VARCHAR(24) NOT NULL DEFAULT 'Média',
  status VARCHAR(48) NOT NULL DEFAULT 'Criada',
  is_parent_task TINYINT(1) NOT NULL DEFAULT 0,
  parent_task_id INT NULL,
  criadaEm VARCHAR(64) NOT NULL DEFAULT '',
  historico LONGTEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_op_tasks_categoria (categoria),
  KEY idx_op_tasks_status (status),
  KEY idx_op_tasks_parent (parent_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notas do calendário ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_notes (
  id INT NOT NULL,
  `date` DATE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(24) NOT NULL DEFAULT 'Média',
  createdAt VARCHAR(64) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cal_notes_date (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Configuração (webhook Google Chat, nota do planner) ───────────────────
CREATE TABLE IF NOT EXISTS app_config (
  cfg_key VARCHAR(64) NOT NULL,
  cfg_value LONGTEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cfg_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Usuários (login do painel) ─────────────────────────────────────────
-- Senhas armazenadas como PBKDF2 (sha256) com salt por usuário.
CREATE TABLE IF NOT EXISTS usuario (
  username VARCHAR(120) NOT NULL,
  pass_salt CHAR(64) NOT NULL,
  pass_hash CHAR(64) NOT NULL,
  pass_iterations INT NOT NULL DEFAULT 200000,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed de usuários
INSERT INTO usuario (username, pass_salt, pass_hash, pass_iterations) VALUES
  ('matheusibipar', '875b4a8a18dab90ef6e72ff458a62e4c', '3bb14af947ba5961ab9ffcd273971e8046f8de39da39ed3118f405daa8dbead3', 200000),
  ('nathibipar', 'fef7b4c16f34cf9b377ca6261b63ddd1', '75a9053c65a7c730553a244a31e61241a3b7a7a390bbd69409a5bd30f19b18d1', 200000),
  ('davyibipar', 'b6c8638ee4270857676e48eae3efe0ab', 'ae7d7dec31fa1cb76b5fd5c6019e9e5ae3c13bb40c31b1094244520425e7c5f9', 200000),
  ('joaoibipar', '98842076ab96c6aac16fa41eedd9a57b', '5b27a553369af7f024a2d724147fb51b340adec2800d66f2410b0c1167efcba5', 200000),
  ('danielaibipar', '24f8f891049c676561b19ea4f02d1c4c', '851e94ccac3b76622591964b3c14750295e4ecb28538c3b499f7af026e987096', 200000),
  ('marcosibipar', 'e02ef370f89983b37f607f5e40ce2ecc', 'ffbd427db36245f4817053c1057d3adb468209f5d1cc28c29bb7b0c8f5894822', 200000),
  ('jobertibipar', '50a18951a0174b18385f4ffa558cfb3b', '2eca9f61259b6452b5baa9e5f8373f79f0a5d50e18d8af86bb5f87a16e4be144', 200000),
  ('ederibipar', 'b9e32d297149523fceb754da3e18bb1f', '8ebf56014aa9c852027a4c6a2fc72f682acae47d780b17efddb4efeb80360855', 200000)
ON DUPLICATE KEY UPDATE
  pass_salt = VALUES(pass_salt),
  pass_hash = VALUES(pass_hash),
  pass_iterations = VALUES(pass_iterations);

SET FOREIGN_KEY_CHECKS = 1;
