<?php
declare(strict_types=1);
require __DIR__ . '/db.php';
require __DIR__ . '/op_desc_images.inc.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
}

try {
    requireAuth();

    $pdo = db();
    $since = isset($_GET['since']) ? (int) $_GET['since'] : 0;

    $getMaxTs = function (string $table) use ($pdo): int {
        // Retorna epoch seconds (UTC) para comparar rápido no front.
        $stmt = $pdo->query("SELECT UNIX_TIMESTAMP(COALESCE(MAX(updated_at), '1970-01-01 00:00:00')) AS ts FROM {$table}");
        $row = $stmt->fetch();
        return (int) ($row['ts'] ?? 0);
    };
    $tableExists = function (string $table) use ($pdo): bool {
        $stmt = $pdo->prepare(
            'SELECT 1
               FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = :table
              LIMIT 1'
        );
        $stmt->execute([':table' => $table]);
        return (bool) $stmt->fetchColumn();
    };

    // Tabelas com updated_at no schema.sql
    $tasksTs = $getMaxTs('tasks');
    $opTasksTs = $getMaxTs('op_tasks');
    $cfgTs = $getMaxTs('app_config');
    $notifsTs = $getMaxTs('app_notification');
    $actTs = $getMaxTs('app_activity_event');
    $hasDeletedLog = $tableExists('deleted_entity_log');
    $deletedTs = $hasDeletedLog ? $getMaxTs('deleted_entity_log') : 0;
    $maxTs = max($tasksTs, $opTasksTs, $cfgTs, $notifsTs);
    $maxTs = max($maxTs, $actTs, $deletedTs);

    $changedTasks = [];
    $changedOpTasks = [];
    $changedNotifs = [];
    $changedActivity = [];
    $changedDeleted = [];
    if ($since > 0) {
        // Retorna apenas alterações desde o último poll (bem mais rápido que bootstrap completo).
        // Importante: updated_at geralmente tem precisão de 1 segundo. Usar >= evita “perder” updates no mesmo segundo.
        $stmtT = $pdo->prepare('SELECT id, titulo, responsavel, prazo, status, prioridade, updated_at FROM tasks WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC');
        $stmtT->execute([':since' => $since]);
        $changedTasks = $stmtT->fetchAll() ?: [];

        $opSql = 'SELECT id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
          coordenadas, localizacao_texto AS localizacaoTexto, descricao, categoria, prazo, prioridade, status,
          is_parent_task, parent_task_id, criadaEm, historico, chat_thread_key AS chatThreadKey,
          nome_cliente AS nomeCliente, protocolo, data_entrada AS dataEntrada,
          data_instalacao AS dataInstalacao,
          assinada_por AS assinadaPor, assinada_em AS assinadaEm, updated_at
          FROM op_tasks WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC';
        $stmtO = $pdo->prepare($opSql);
        $stmtO->execute([':since' => $since]);
        $changedOpTasks = $stmtO->fetchAll() ?: [];
        foreach ($changedOpTasks as &$item) {
            $item['descricao'] = sanitizeOpTaskDescricaoHtml((string) ($item['descricao'] ?? ''));
            $item['historico'] = json_decode((string) ($item['historico'] ?? '[]'), true) ?: [];
            $item['isParentTask'] = ((int) ($item['is_parent_task'] ?? 0)) === 1;
            $item['parentTaskId'] = isset($item['parent_task_id']) ? (int) $item['parent_task_id'] : null;
            unset($item['is_parent_task'], $item['parent_task_id']);
        }

        $stmtN = $pdo->prepare('SELECT id, kind, title, message, ref_type, ref_id, op_category AS opCategory,
          created_by AS createdBy, created_at AS createdAt, updated_at
          FROM app_notification WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC');
        $stmtN->execute([':since' => $since]);
        $changedNotifs = $stmtN->fetchAll() ?: [];

        // Feed global (todos os usuários)
        $stmtA = $pdo->prepare('SELECT id, username, event_type AS eventType, severity, message, ref_type AS refType, ref_id AS refId,
          op_category AS opCategory, created_at AS createdAt, updated_at
          FROM app_activity_event WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC');
        $stmtA->execute([':since' => $since]);
        $changedActivity = $stmtA->fetchAll() ?: [];

        if ($hasDeletedLog) {
            $stmtD = $pdo->prepare('SELECT id, entity_type AS entityType, entity_id AS entityId,
              parent_entity_id AS parentEntityId, deleted_by AS deletedBy, deleted_at AS deletedAt, updated_at
              FROM deleted_entity_log WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC');
            $stmtD->execute([':since' => $since]);
            $changedDeleted = $stmtD->fetchAll() ?: [];
        }
    }

    jsonResponse([
        'ok' => true,
        'tasks' => $tasksTs,
        'opTasks' => $opTasksTs,
        'config' => $cfgTs,
        'notifications' => $notifsTs,
        'activity' => $actTs,
        'deleted' => $deletedTs,
        'serverTime' => time(),
        'nextSince' => $maxTs,
        'since' => $since,
        'changedTasks' => $changedTasks,
        'changedOpTasks' => $changedOpTasks,
        'changedNotifications' => $changedNotifs,
        'changedActivity' => $changedActivity,
        'changedDeletedEntities' => $changedDeleted,
    ]);
} catch (Throwable $e) {
    error_log('[changes.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

