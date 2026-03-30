-- usuários mauricioibipar e joaopdr (PBKDF2-SHA256, 60k iterações — alinhado a login.php / schema).
INSERT INTO usuario (username, pass_salt, pass_hash, pass_iterations) VALUES
  ('mauricioibipar', '9e4be252661f4bff94bc4eea3c41e022', '5131a3544c1faaa341baa1d9f270fed8bffac6b8f89cc4f8bfcbdf79edc3cb56', 60000),
  ('joaopdr', '405730225804403437fc648d9b01af4c', '16c63a634ddc92a18c65f48dd7538228366d48de47ac1940d67094ef175592e1', 60000)
ON DUPLICATE KEY UPDATE
  pass_salt = VALUES(pass_salt),
  pass_hash = VALUES(pass_hash),
  pass_iterations = VALUES(pass_iterations);
