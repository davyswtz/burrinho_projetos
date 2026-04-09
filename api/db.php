<?php
declare(strict_types=1);

/**
 * Sessão compartilhada pelos endpoints da API.
 */
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

/**
 * Conexão MySQL — HostGator/cPanel ou variáveis de ambiente.
 * Preferência: api/credentials.php (copie de credentials.example.php).
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = getenv('DB_HOST') ?: 'localhost';
    $name = getenv('DB_NAME') ?: '';
    $user = getenv('DB_USER') ?: '';
    $pass = getenv('DB_PASS') ?: '';
    $port = getenv('DB_PORT') ?: '3306';

    $credFile = __DIR__ . '/credentials.php';
    if (is_readable($credFile)) {
        $c = require $credFile;
        if (is_array($c)) {
            $host = (string) ($c['host'] ?? $host);
            $name = (string) ($c['database'] ?? $c['name'] ?? $name);
            $user = (string) ($c['user'] ?? $c['username'] ?? $user);
            $pass = (string) ($c['password'] ?? $c['pass'] ?? $pass);
            $port = (string) ($c['port'] ?? $port);
        }
    }

    if ($name === '' || $user === '') {
        throw new RuntimeException(
            'Configure MySQL: crie api/credentials.php a partir de credentials.example.php ' .
            'ou defina DB_NAME e DB_USER no servidor.'
        );
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
    ]);

    return $pdo;
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // HostGator/cPanel pode ter cache/proxy agressivo: nunca cachear respostas JSON da API.
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

