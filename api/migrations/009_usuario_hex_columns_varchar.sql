-- Evita padding de espaços de CHAR(...) que quebra hex2bin nos logins (erro 500 no PHP).
-- Execute no phpMyAdmin no banco de produção uma vez.

ALTER TABLE usuario
  MODIFY pass_salt VARCHAR(64) NOT NULL,
  MODIFY pass_hash VARCHAR(64) NOT NULL;
