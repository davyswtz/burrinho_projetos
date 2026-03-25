-- Login mais rápido em HostGator: PBKDF2 200k → 60k (mesmas senhas dos usuários).
-- Execute no phpMyAdmin se o login já existia com o schema antigo.
-- Novas instalações já vêm com 60k em `api/schema.sql`.

INSERT INTO usuario (username, pass_salt, pass_hash, pass_iterations) VALUES
  ('matheusibipar', 'd4bdc0204af1eb1f1c479b73cac44aa8', '49f5a799a7b3b19967ea4faa744c36f1ebf26789a029886194a42c3304ee25dd', 60000),
  ('nathibipar', '386d75af527d5e3c4809312e99ec4e45', '7be6440364607e51e009b395c27365f1460c635cf4d81ca7fb9ca4e5661fb326', 60000),
  ('davyibipar', '955523a4155ff19d972b552b332b843d', 'b794bdd43d48443d21bcf917cfd2b948d59ca55c1a9d5f65e448f07cd6e8c8e4', 60000),
  ('joaoibipar', '1caa710951958623cfc9bffb426085c9', '0faa8561980a45d6dfa1a8b53c95f12a924270a06e591f80ebbb5d9d70a481d4', 60000),
  ('danielaibipar', '53d858ff60f593d3bda7e4075b3386a3', '8a5fa588f839f73d1c4c84bac21b1cf2771bd6299f7f1bfdb3c8b83a329ff22d', 60000),
  ('marcosibipar', '44a7c0fcd4fe5864ce6a78d0d3a82d04', '3b260c64a81fadf7782f63e81653a5b76a3ff41b812dd4a1204af38624551ef2', 60000),
  ('jobertibipar', 'eeaafc242a2210ec94259cee2c6a37ac', 'f106e6808827dc47034e48e04ed29d2abc99e1593c8b55b06f570762b47e566e', 60000),
  ('ederibipar', '4d21f7ce24bbb4267a5323cd1e48c60b', 'a60703a78acede2b2177a5f1d23856614dfe9704c7bed4612a67ef3a0e5e1467', 60000)
ON DUPLICATE KEY UPDATE
  pass_salt = VALUES(pass_salt),
  pass_hash = VALUES(pass_hash),
  pass_iterations = VALUES(pass_iterations);
