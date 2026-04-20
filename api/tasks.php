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
    requireAuth();
    requireSameOriginForMutation();

    $data = readJsonBody();
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
    }
    $titulo = trim((string) ($data['titulo'] ?? ''));
    if ($titulo === '') {
        jsonResponse(['ok' => false, 'error' => 'titulo invalido'], 422);
    }

    $pdo = db();
    // FIX: DATE vazia no MySQL pode virar 0000-00-00; usar NULL.
    $prazoIn = trim((string) ($data['prazo'] ?? ''));
    $prazoBind = ($prazoIn === '' || $prazoIn === '0000-00-00') ? null : $prazoIn;
    $sql = 'INSERT INTO tasks (id, titulo, responsavel, prazo, status, prioridade)
            VALUES (:id, :titulo, :responsavel, :prazo, :status, :prioridade)
            ON DUPLICATE KEY UPDATE
              titulo = VALUES(titulo),
              responsavel = VALUES(responsavel),
              prazo = VALUES(prazo),
              status = VALUES(status),
              prioridade = VALUES(prioridade),
              updated_at = NOW()';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':id' => $id,
        ':titulo' => $titulo,
        ':responsavel' => (string) ($data['responsavel'] ?? ''),
        ':prazo' => $prazoBind,
        ':status' => (string) ($data['status'] ?? 'Pendente'),
        ':prioridade' => (string) ($data['prioridade'] ?? 'Média'),
    ]);

    jsonResponse(['ok' => true]);
} catch (Throwable $e) {
    // FIX: não vazar detalhes internos; logar com contexto.
    error_log('[tasks.php] save failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

