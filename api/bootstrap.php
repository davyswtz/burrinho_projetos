<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    $pdo = db();
    $tasks = $pdo->query('SELECT id, titulo, responsavel, prazo, status, prioridade FROM tasks ORDER BY id ASC')->fetchAll();
    $opSql = 'SELECT id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
      coordenadas, localizacao_texto AS localizacaoTexto, descricao, categoria, prazo, prioridade, status,
      is_parent_task, parent_task_id, criadaEm, historico
      FROM op_tasks ORDER BY id ASC';
    $opTasks = $pdo->query($opSql)->fetchAll();
    $calendarNotes = $pdo->query(
        'SELECT id, `date`, title, description, priority, createdAt FROM calendar_notes ORDER BY id ASC'
    )->fetchAll();
    $cfgRows = $pdo->query('SELECT cfg_key, cfg_value FROM app_config')->fetchAll();

    $cfgMap = [];
    foreach ($cfgRows as $row) {
        $cfgMap[$row['cfg_key']] = json_decode((string) $row['cfg_value'], true);
    }

    foreach ($opTasks as &$item) {
        $item['historico'] = json_decode((string) ($item['historico'] ?? '[]'), true) ?: [];
        $item['isParentTask'] = ((int) ($item['is_parent_task'] ?? 0)) === 1;
        $item['parentTaskId'] = isset($item['parent_task_id']) ? (int) $item['parent_task_id'] : null;
        unset($item['is_parent_task'], $item['parent_task_id']);
    }

    jsonResponse([
        'ok' => true,
        'tasks' => $tasks,
        'opTasks' => $opTasks,
        'calendarNotes' => $calendarNotes,
        'webhookConfig' => $cfgMap['webhookConfig'] ?? ['url' => '', 'events' => ['andamento' => true, 'concluida' => true, 'finalizada' => true]],
        'plannerConfig' => $cfgMap['plannerConfig'] ?? ['note' => ''],
    ]);
} catch (Throwable $e) {
    jsonResponse(['ok' => false, 'error' => $e->getMessage()], 500);
}

