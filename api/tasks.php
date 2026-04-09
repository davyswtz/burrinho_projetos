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
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
    }

    $pdo = db();
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
        ':titulo' => (string) ($data['titulo'] ?? ''),
        ':responsavel' => (string) ($data['responsavel'] ?? ''),
        ':prazo' => (string) ($data['prazo'] ?? ''),
        ':status' => (string) ($data['status'] ?? 'Pendente'),
        ':prioridade' => (string) ($data['prioridade'] ?? 'Média'),
    ]);

    jsonResponse(['ok' => true]);
} catch (Throwable $e) {
    jsonResponse(['ok' => false, 'error' => $e->getMessage()], 500);
}

