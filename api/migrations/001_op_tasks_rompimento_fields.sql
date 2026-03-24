-- Atualização: campos de rompimento / região (instalações criadas antes de 2026).
-- Se a coluna já existir, o MySQL retorna erro duplicado — ignore ou comente a linha.

ALTER TABLE op_tasks ADD COLUMN regiao VARCHAR(64) NOT NULL DEFAULT '' AFTER setor;
ALTER TABLE op_tasks ADD COLUMN coordenadas VARCHAR(120) NOT NULL DEFAULT '' AFTER clientesAfetados;
ALTER TABLE op_tasks ADD COLUMN localizacao_texto VARCHAR(512) NOT NULL DEFAULT '' AFTER coordenadas;
