<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

function loginRateKey(string $username): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return sys_get_temp_dir() . '/planner_login_' . hash('sha256', $ip . '|' . $username) . '.json';
}

function enforceLoginRateLimit(string $username): void
{
    $file = loginRateKey($username);
    $now = time();
    $data = [];
    if (is_readable($file)) {
        $data = json_decode((string) file_get_contents($file), true) ?: [];
    }
    $first = (int) ($data['first'] ?? $now);
    $fails = (int) ($data['fails'] ?? 0);
    if (($now - $first) > 600) {
        $first = $now;
        $fails = 0;
    }
    if ($fails >= 8) {
        jsonResponse(['ok' => false, 'error' => 'too_many_attempts'], 429);
    }
}

function recordLoginFailure(string $username): void
{
    $file = loginRateKey($username);
    $now = time();
    $data = [];
    if (is_readable($file)) {
        $data = json_decode((string) file_get_contents($file), true) ?: [];
    }
    $first = (int) ($data['first'] ?? $now);
    $fails = (int) ($data['fails'] ?? 0);
    if (($now - $first) > 600) {
        $first = $now;
        $fails = 0;
    }
    @file_put_contents($file, json_encode(['first' => $first, 'fails' => $fails + 1]), LOCK_EX);
}

function clearLoginFailures(string $username): void
{
    $file = loginRateKey($username);
    if (is_file($file)) {
        @unlink($file);
    }
}

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
    enforceLoginRateLimit($username);

    $pdo = db();
    $stmt = $pdo->prepare('SELECT pass_salt, pass_hash, pass_iterations FROM usuario WHERE username = :u LIMIT 1');
    $stmt->execute([':u' => $username]);
    $row = $stmt->fetch();

    if (!$row) {
        recordLoginFailure($username);
        jsonResponse(['ok' => false]);
    }

    // MySQL CHAR(n) faz padding com espaços no fim — hex2bin() falha (PHP 8.4+: ValueError) e vira erro 500.
    $saltHex = preg_replace('/\s+/', '', (string) $row['pass_salt']);
    $hashHex = preg_replace('/\s+/', '', (string) $row['pass_hash']);
    $salt = hex2bin($saltHex);
    $expected = hex2bin($hashHex);
    // Limite defensivo (evita corpos POST com iterations absurdas se o esquema for alterado).
    $iterations = (int) ($row['pass_iterations'] ?? 60000);
    if ($iterations < 10000 || $iterations > 600000) {
        $iterations = 60000;
    }

    if ($salt === false || $expected === false || $iterations <= 0) {
        recordLoginFailure($username);
        jsonResponse(['ok' => false]);
    }

    $computed = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    $valid = hash_equals($expected, $computed);

    if ($valid) {
        // Marca sessão autenticada para os demais endpoints PHP.
        session_regenerate_id(true);
        $_SESSION['planner_user'] = $username;
        clearLoginFailures($username);
    } else {
        recordLoginFailure($username);
    }

    jsonResponse(['ok' => $valid]);
} catch (Throwable $e) {
    // Não vazar detalhes de erro para o front.
    error_log('[login.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'internal_error'], 500);
}

