<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

/**
 * Evita cache intermediário (CDN/navegador) em lista de mensagens.
 */
function chatJsonResponse(array $payload, int $status = 200): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    jsonResponse($payload, $status);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    chatJsonResponse(['ok' => true]);
}

/**
 * Lista mensagens: sem ?since → últimas 100; com ?since=ID → id > since (até 100).
 * POST: { "userKey", "displayName"?, "body" } — userKey deve existir em usuario.
 */
try {
    $pdo = db();
    requireAuth();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $since = isset($_GET['since']) ? (int) $_GET['since'] : 0;

        if ($since > 0) {
            $stmt = $pdo->prepare(
                'SELECT id, username, display_name, body, created_at
                 FROM team_chat_message
                 WHERE id > :since
                 ORDER BY id ASC
                 LIMIT 100'
            );
            $stmt->execute([':since' => $since]);
            $rows = $stmt->fetchAll();
        } else {
            $rows = $pdo->query(
                'SELECT id, username, display_name, body, created_at
                 FROM (
                   SELECT id, username, display_name, body, created_at
                   FROM team_chat_message
                   ORDER BY id DESC
                   LIMIT 100
                 ) t
                 ORDER BY id ASC'
            )->fetchAll();
        }

        $messages = [];
        $lastId = 0;
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            $lastId = max($lastId, $id);
            $created = $row['created_at'] ?? '';
            $createdAt = $created instanceof DateTimeInterface
                ? $created->format('Y-m-d H:i:s')
                : (string) $created;
            $messages[] = [
                'id' => $id,
                'userKey' => (string) $row['username'],
                'displayName' => (string) $row['display_name'],
                'body' => (string) $row['body'],
                'createdAt' => $createdAt,
            ];
        }

        $payload = ['ok' => true, 'messages' => $messages, 'lastId' => $lastId];
        // Roster para @menções (só na carga inicial — evita repetir a cada poll).
        if ($since === 0) {
            $rosterRows = $pdo->query('SELECT username FROM usuario ORDER BY username ASC')->fetchAll();
            $teamRoster = [];
            foreach ($rosterRows as $rr) {
                $u = strtolower(trim((string) ($rr['username'] ?? '')));
                if ($u !== '') {
                    $teamRoster[] = ['userKey' => $u];
                }
            }
            $payload['teamRoster'] = $teamRoster;
        }

        chatJsonResponse($payload);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        chatJsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
    }

    requireSameOriginForMutation();

    $data = readJsonBody();
    $userKey = strtolower(trim((string) ($_SESSION['planner_user'] ?? '')));
    $displayName = $userKey;
    $body = trim((string) ($data['body'] ?? ''));

    if ($userKey === '' || $body === '') {
        chatJsonResponse(['ok' => false, 'error' => 'invalid_payload'], 400);
    }

    if (strlen($body) > 2000) {
        chatJsonResponse(['ok' => false, 'error' => 'message_too_long'], 400);
    }

    if ($displayName === '') {
        $displayName = $userKey;
    }
    if (strlen($displayName) > 120) {
        $displayName = substr($displayName, 0, 120);
    }

    $check = $pdo->prepare('SELECT 1 FROM usuario WHERE username = :u LIMIT 1');
    $check->execute([':u' => $userKey]);
    if (!$check->fetchColumn()) {
        chatJsonResponse(['ok' => false, 'error' => 'unknown_user'], 403);
    }

    $ins = $pdo->prepare(
        'INSERT INTO team_chat_message (username, display_name, body)
         VALUES (:u, :d, :b)'
    );
    $ins->execute([
        ':u' => $userKey,
        ':d' => $displayName,
        ':b' => $body,
    ]);

    $newId = (int) $pdo->lastInsertId();
    chatJsonResponse([
        'ok' => true,
        'id' => $newId,
    ]);
} catch (Throwable $e) {
    error_log('[chat.php] failed: ' . $e->getMessage());
    $msg = $e->getMessage();
    if (
        stripos($msg, 'team_chat_message') !== false
        || stripos($msg, "doesn't exist") !== false
        || stripos($msg, 'Unknown table') !== false
        || stripos($msg, "não existe") !== false
        || stripos($msg, '1146') !== false
    ) {
        chatJsonResponse([
            'ok' => false,
            'error' => 'table_missing',
            'hint' => 'Execute api/migrations/006_team_chat_message.sql no MySQL.',
        ], 500);
    }
    chatJsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}
