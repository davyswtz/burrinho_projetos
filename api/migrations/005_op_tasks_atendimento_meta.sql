-- ═══════════════════════════════════════════════════════════════════════════
-- op_tasks — metadados de Atendimento ao Cliente + tópico Google Chat
-- Importe no mesmo banco do painel (phpMyAdmin → SQL, ou mysql CLI).
--
-- Compatível com MySQL 5.7+ e MariaDB (evita ADD COLUMN IF NOT EXISTS, que
-- gera erro #1064 em muitos servidores MySQL / phpMyAdmin).
--
-- Garante colunas usadas por api/op_tasks.php, bootstrap.php e changes.php:
--   chat_thread_key, nome_cliente, protocolo, data_entrada, data_instalacao,
--   assinada_por, assinada_em
-- ═══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @db := DATABASE();
-- Aspas simples do DEFAULT '' via CHAR(39) (evita escape em strings dinâmicas).
SET @empty := CONCAT(CHAR(39), CHAR(39));

-- 1) chat_thread_key (pode coincidir com migration 003)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'chat_thread_key');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN chat_thread_key VARCHAR(140) NOT NULL DEFAULT ', @empty, ' AFTER historico'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 2) nome_cliente
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'nome_cliente');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN nome_cliente VARCHAR(255) NOT NULL DEFAULT ', @empty, ' AFTER chat_thread_key'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 3) protocolo
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'protocolo');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN protocolo VARCHAR(180) NOT NULL DEFAULT ', @empty, ' AFTER nome_cliente'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 4) data_entrada
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'data_entrada');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN data_entrada VARCHAR(64) NOT NULL DEFAULT ', @empty, ' AFTER protocolo'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 5) data_instalacao (data de saída / dataInstalacao no front)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'data_instalacao');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN data_instalacao VARCHAR(64) NOT NULL DEFAULT ', @empty, ' AFTER data_entrada'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 6) assinada_por
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'assinada_por');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN assinada_por VARCHAR(120) NOT NULL DEFAULT ', @empty, ' AFTER data_instalacao'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;

-- 7) assinada_em
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'op_tasks' AND COLUMN_NAME = 'assinada_em');
SET @sql := IF(@c = 0, CONCAT('ALTER TABLE op_tasks ADD COLUMN assinada_em VARCHAR(64) NOT NULL DEFAULT ', @empty, ' AFTER assinada_por'), 'SELECT 1');
PREPARE _m FROM @sql;
EXECUTE _m;
DEALLOCATE PREPARE _m;
