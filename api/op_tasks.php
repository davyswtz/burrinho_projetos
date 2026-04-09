<?php
declare(strict_types=1);
require __DIR__ . '/db.php';
require __DIR__ . '/op_desc_images.inc.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'DELETE') {
        $data = readJsonBody();
        $id = (int) ($data['id'] ?? 0);
        if ($id <= 0) {
            jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        }
        $cascade = !empty($data['cascade']);
        $pdo = db();
        if ($cascade) {
            $stmt = $pdo->prepare('DELETE FROM op_tasks WHERE id = :id OR parent_task_id = :id');
            $stmt->execute([':id' => $id]);
        } else {
            $pdo->prepare('DELETE FROM op_task_image WHERE op_task_id = :id')->execute([':id' => $id]);
            $stmt = $pdo->prepare('DELETE FROM op_tasks WHERE id = :id');
            $stmt->execute([':id' => $id]);
        }
        jsonResponse(['ok' => true]);
    }

    if ($method !== 'POST') {
        jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
    }

    $data = readJsonBody();
    $id = (int) ($data['id'] ?? 0);
    if ($id <= 0) {
        jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
    }

    $pdo = db();
    $coord = (string) ($data['coordenadas'] ?? '');
    $locText = (string) ($data['localizacaoTexto'] ?? '');
    $descricaoRaw = (string) ($data['descricao'] ?? '');
    $sql = 'INSERT INTO op_tasks (
              id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
              coordenadas, localizacao_texto, descricao, categoria, prazo, prioridade, status,
              is_parent_task, parent_task_id, criadaEm, historico, chat_thread_key
            )
            VALUES (
              :id, :taskCode, :titulo, :setor, :regiao, :responsavel, :clientesAfetados,
              :coordenadas, :localizacao_texto, :descricao, :categoria, :prazo, :prioridade, :status,
              :is_parent_task, :parent_task_id, :criadaEm, :historico, :chat_thread_key
            )
            ON DUPLICATE KEY UPDATE
              taskCode = VALUES(taskCode),
              titulo = VALUES(titulo),
              setor = VALUES(setor),
              regiao = VALUES(regiao),
              responsavel = VALUES(responsavel),
              clientesAfetados = VALUES(clientesAfetados),
              coordenadas = VALUES(coordenadas),
              localizacao_texto = VALUES(localizacao_texto),
              descricao = VALUES(descricao),
              categoria = VALUES(categoria),
              prazo = VALUES(prazo),
              prioridade = VALUES(prioridade),
              status = VALUES(status),
              is_parent_task = VALUES(is_parent_task),
              parent_task_id = VALUES(parent_task_id),
              criadaEm = VALUES(criadaEm),
              historico = VALUES(historico),
              chat_thread_key = VALUES(chat_thread_key),
              updated_at = NOW()';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':id' => $id,
        ':taskCode' => (string) ($data['taskCode'] ?? ''),
        ':titulo' => (string) ($data['titulo'] ?? ''),
        ':setor' => (string) ($data['setor'] ?? ''),
        ':regiao' => (string) ($data['regiao'] ?? ''),
        ':responsavel' => (string) ($data['responsavel'] ?? ''),
        ':clientesAfetados' => (string) ($data['clientesAfetados'] ?? ''),
        ':coordenadas' => $coord,
        ':localizacao_texto' => $locText,
        ':descricao' => $descricaoRaw,
        ':categoria' => (string) ($data['categoria'] ?? 'rompimentos'),
        ':prazo' => (string) ($data['prazo'] ?? ''),
        ':prioridade' => (string) ($data['prioridade'] ?? 'Média'),
        ':status' => (string) ($data['status'] ?? 'Criada'),
        ':is_parent_task' => !empty($data['isParentTask']) ? 1 : 0,
        ':parent_task_id' => isset($data['parentTaskId']) && $data['parentTaskId'] !== '' ? (int) $data['parentTaskId'] : null,
        ':criadaEm' => (string) ($data['criadaEm'] ?? date('c')),
        ':historico' => json_encode($data['historico'] ?? [], JSON_UNESCAPED_UNICODE),
        ':chat_thread_key' => (string) ($data['chatThreadKey'] ?? ''),
    ]);

    $finalDesc = processOpTaskDescricaoImages($descricaoRaw, $id, $pdo);
    pruneOpTaskImagesNotInHtml($pdo, $id, $finalDesc);
    if ($finalDesc !== $descricaoRaw) {
        $u = $pdo->prepare('UPDATE op_tasks SET descricao = :d WHERE id = :id');
        $u->execute([':d' => $finalDesc, ':id' => $id]);
    }

    jsonResponse(['ok' => true, 'descricao' => $finalDesc]);
} catch (Throwable $e) {
    jsonResponse(['ok' => false, 'error' => $e->getMessage()], 500);
}

