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

SET FOREIGN_KEY_CHECKS = 1;
