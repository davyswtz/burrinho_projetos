<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
}

try {
    $data = readJsonBody();
    $username = strtolower(trim((string) ($data['username'] ?? '')));
    $password = (string) ($data['password'] ?? '');

    if ($username === '' || $password === '') {
        jsonResponse(['ok' => false]);
    }

    $pdo = db();
    $stmt = $pdo->prepare('SELECT pass_salt, pass_hash, pass_iterations FROM usuario WHERE username = :u LIMIT 1');
    $stmt->execute([':u' => $username]);
    $row = $stmt->fetch();

    if (!$row) {
        jsonResponse(['ok' => false]);
    }

    $salt = hex2bin((string) $row['pass_salt']);
    $expected = hex2bin((string) $row['pass_hash']);
    // Limite defensivo (evita corpos POST com iterations absurdas se o esquema for alterado).
    $iterations = (int) ($row['pass_iterations'] ?? 60000);
    if ($iterations < 10000 || $iterations > 600000) {
        $iterations = 60000;
    }

    if ($salt === false || $expected === false || $iterations <= 0) {
        jsonResponse(['ok' => false]);
    }

    $computed = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    $valid = hash_equals($expected, $computed);

    jsonResponse(['ok' => $valid]);
} catch (Throwable $e) {
    // Não vazar detalhes de erro para o front.
    jsonResponse(['ok' => false, 'error' => 'internal_error'], 200);
}

