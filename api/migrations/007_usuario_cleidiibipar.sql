-- Usuário cleidiibipar
-- Obs: não colocar senha em texto no repositório.
-- PBKDF2-SHA256, 60000 iterações (igual login.php / schema.sql).
-- Execute no phpMyAdmin ou: mysql -u USUARIO -p BANCO < api/migrations/007_usuario_cleidiibipar.sql

INSERT INTO usuario (username, pass_salt, pass_hash, pass_iterations) VALUES
  ('cleidiibipar', 'a2390b2847c278fd67376d3a4ade2686', 'f0a8b037f7c1ef2bff008fb6d8043cef0cb2a389e6e55e230a22d272ebc8dfd9', 60000)
ON DUPLICATE KEY UPDATE
  pass_salt = VALUES(pass_salt),
  pass_hash = VALUES(pass_hash),
  pass_iterations = VALUES(pass_iterations);
