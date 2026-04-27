<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    if (empty($_SESSION['planner_user'])) {
        jsonResponse(['ok' => false, 'error' => 'unauthorized'], 401);
    }

    $pdo = db();
    $tasks = $pdo->query('SELECT id, titulo, responsavel, prazo, status, prioridade FROM tasks ORDER BY id ASC')->fetchAll();
    $opSql = 'SELECT id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
      coordenadas, localizacao_texto AS localizacaoTexto, descricao, categoria, prazo, prioridade, status,
      is_parent_task, parent_task_id, criadaEm, historico, chat_thread_key AS chatThreadKey,
      nome_cliente AS nomeCliente, protocolo, data_entrada AS dataEntrada,
      data_instalacao AS dataInstalacao,
      assinada_por AS assinadaPor, assinada_em AS assinadaEm
      FROM op_tasks ORDER BY id ASC';
    $opTasks = $pdo->query($opSql)->fetchAll();
    $cfgRows = $pdo->query('SELECT cfg_key, cfg_value FROM app_config')->fetchAll();
    $notifs = $pdo
        ->query('SELECT id, kind, title, message, ref_type, ref_id, op_category AS opCategory, created_by AS createdBy, created_at AS createdAt
                 FROM app_notification ORDER BY id DESC LIMIT 50')
        ->fetchAll();
    // Feed global (todos os usuários)
    $activity = $pdo
        ->query('SELECT id, username, event_type AS eventType, severity, message, ref_type AS refType, ref_id AS refId,
          op_category AS opCategory, created_at AS createdAt
          FROM app_activity_event ORDER BY id DESC LIMIT 30')
        ->fetchAll() ?: [];

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
        'notifications' => array_reverse($notifs ?: []),
        'activity' => array_reverse($activity ?: []),
        'webhookConfig' => $cfgMap['webhookConfig'] ?? ['url' => '', 'events' => ['andamento' => true, 'concluida' => true, 'finalizada' => true]],
        'plannerConfig' => $cfgMap['plannerConfig'] ?? ['note' => ''],
    ]);
} catch (Throwable $e) {
    // FIX: não vazar detalhes internos; logar com contexto.
    error_log('[bootstrap.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

