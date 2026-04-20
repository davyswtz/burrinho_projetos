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
    $pdo = db();

    $stmt = $pdo->prepare('INSERT INTO app_config (cfg_key, cfg_value) VALUES (:k, :v) ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value)');
    if (isset($data['webhookConfig'])) {
        $stmt->execute([
            ':k' => 'webhookConfig',
            ':v' => json_encode($data['webhookConfig'], JSON_UNESCAPED_UNICODE),
        ]);
    }
    if (isset($data['plannerConfig'])) {
        $stmt->execute([
            ':k' => 'plannerConfig',
            ':v' => json_encode($data['plannerConfig'], JSON_UNESCAPED_UNICODE),
        ]);
    }

    jsonResponse(['ok' => true]);
} catch (Throwable $e) {
    error_log('[config.php] save failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

