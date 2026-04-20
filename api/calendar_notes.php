<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    requireAuth();
    requireSameOriginForMutation();

    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = readJsonBody();
        $id = (int) ($data['id'] ?? 0);
        if ($id <= 0) {
            jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        }
        $dateIn = trim((string) ($data['date'] ?? ''));
        if ($dateIn === '' || $dateIn === '0000-00-00') {
            jsonResponse(['ok' => false, 'error' => 'data invalida'], 422);
        }
        $sql = 'INSERT INTO calendar_notes (id, `date`, title, description, priority, createdAt)
                VALUES (:id, :note_date, :title, :description, :priority, :createdAt)
                ON DUPLICATE KEY UPDATE
                  `date` = VALUES(`date`),
                  title = VALUES(title),
                  description = VALUES(description),
                  priority = VALUES(priority),
                  createdAt = VALUES(createdAt)';
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':id' => $id,
            ':note_date' => $dateIn,
            ':title' => (string) ($data['title'] ?? ''),
            ':description' => (string) ($data['description'] ?? ''),
            ':priority' => (string) ($data['priority'] ?? 'Média'),
            ':createdAt' => (string) ($data['createdAt'] ?? date('c')),
        ]);
        jsonResponse(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $data = readJsonBody();
        $id = (int) ($data['id'] ?? 0);
        if ($id <= 0) {
            jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        }
        $stmt = $pdo->prepare('DELETE FROM calendar_notes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    error_log('[calendar_notes.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

