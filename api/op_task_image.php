<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    requireAuth();

    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
    }

    $id = (int) ($_GET['id'] ?? 0);
    if ($id <= 0) {
        jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
    }

    $pdo = db();
    $stmt = $pdo->prepare('SELECT mime_type, image_data FROM op_task_image WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row || !isset($row['image_data'])) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Not found';
        exit;
    }

    $mime = (string) ($row['mime_type'] ?? 'image/png');
    if (!preg_match('#^image/(png|jpeg|gif|webp)$#i', $mime)) {
        $mime = 'image/png';
    }

    http_response_code(200);
    header('Content-Type: ' . $mime);
    header('Cache-Control: public, max-age=86400');
    // FIX: CORS conservador (sessão). Imagem deve ser consumida pelo mesmo domínio.
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    if ($host !== '') {
        header('Access-Control-Allow-Origin: ' . $scheme . '://' . $host);
        header('Vary: Origin');
    }
    echo $row['image_data'];
    exit;
} catch (Throwable $e) {
    error_log('[op_task_image.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}
