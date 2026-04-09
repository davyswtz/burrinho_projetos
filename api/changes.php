<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
}

try {
    if (empty($_SESSION['planner_user'])) {
        jsonResponse(['ok' => false, 'error' => 'unauthorized'], 401);
    }

    $pdo = db();
    $since = isset($_GET['since']) ? (int) $_GET['since'] : 0;

    $getMaxTs = function (string $table) use ($pdo): int {
        // Retorna epoch seconds (UTC) para comparar rápido no front.
        $stmt = $pdo->query("SELECT UNIX_TIMESTAMP(COALESCE(MAX(updated_at), '1970-01-01 00:00:00')) AS ts FROM {$table}");
        $row = $stmt->fetch();
        return (int) ($row['ts'] ?? 0);
    };

    // Tabelas com updated_at no schema.sql
    $tasksTs = $getMaxTs('tasks');
    $opTasksTs = $getMaxTs('op_tasks');
    $calTs = $getMaxTs('calendar_notes');
    $cfgTs = $getMaxTs('app_config');
    $maxTs = max($tasksTs, $opTasksTs, $calTs, $cfgTs);

    $changedTasks = [];
    $changedOpTasks = [];
    if ($since > 0) {
        // Retorna apenas alterações desde o último poll (bem mais rápido que bootstrap completo).
        // Importante: updated_at geralmente tem precisão de 1 segundo. Usar >= evita “perder” updates no mesmo segundo.
        $stmtT = $pdo->prepare('SELECT id, titulo, responsavel, prazo, status, prioridade, updated_at FROM tasks WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC');
        $stmtT->execute([':since' => $since]);
        $changedTasks = $stmtT->fetchAll() ?: [];

        $opSql = 'SELECT id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
          coordenadas, localizacao_texto AS localizacaoTexto, descricao, categoria, prazo, prioridade, status,
          is_parent_task, parent_task_id, criadaEm, historico, chat_thread_key AS chatThreadKey, updated_at
          FROM op_tasks WHERE updated_at >= FROM_UNIXTIME(:since) ORDER BY updated_at ASC';
        $stmtO = $pdo->prepare($opSql);
        $stmtO->execute([':since' => $since]);
        $changedOpTasks = $stmtO->fetchAll() ?: [];
        foreach ($changedOpTasks as &$item) {
            $item['historico'] = json_decode((string) ($item['historico'] ?? '[]'), true) ?: [];
            $item['isParentTask'] = ((int) ($item['is_parent_task'] ?? 0)) === 1;
            $item['parentTaskId'] = isset($item['parent_task_id']) ? (int) $item['parent_task_id'] : null;
            unset($item['is_parent_task'], $item['parent_task_id']);
        }
    }

    jsonResponse([
        'ok' => true,
        'tasks' => $tasksTs,
        'opTasks' => $opTasksTs,
        'calendarNotes' => $calTs,
        'config' => $cfgTs,
        'serverTime' => time(),
        'nextSince' => $maxTs,
        'since' => $since,
        'changedTasks' => $changedTasks,
        'changedOpTasks' => $changedOpTasks,
    ]);
} catch (Throwable $e) {
    jsonResponse(['ok' => false, 'error' => $e->getMessage()], 500);
}

