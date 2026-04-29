<?php
declare(strict_types=1);
require __DIR__ . '/db.php';
require __DIR__ . '/op_desc_images.inc.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    jsonResponse(['ok' => true]);
}

try {
    requireAuth();
    requireSameOriginForMutation();

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'DELETE') {
        $data = readJsonBody();
        $id = (int) ($data['id'] ?? 0);
        if ($id <= 0) {
            jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        }
        $cascade = !empty($data['cascade']);
        $pdo = db();
        $deletedBy = (string) ($_SESSION['planner_user'] ?? '');
        if ($cascade) {
            $idsStmt = $pdo->prepare('SELECT id, parent_task_id FROM op_tasks WHERE id = :id OR parent_task_id = :id');
            $idsStmt->execute([':id' => $id]);
            $rowsToDelete = $idsStmt->fetchAll() ?: [];
            $stmt = $pdo->prepare('DELETE FROM op_tasks WHERE id = :id OR parent_task_id = :id');
            $stmt->execute([':id' => $id]);
        } else {
            $idsStmt = $pdo->prepare('SELECT id, parent_task_id FROM op_tasks WHERE id = :id');
            $idsStmt->execute([':id' => $id]);
            $rowsToDelete = $idsStmt->fetchAll() ?: [];
            $pdo->prepare('DELETE FROM op_task_image WHERE op_task_id = :id')->execute([':id' => $id]);
            $stmt = $pdo->prepare('DELETE FROM op_tasks WHERE id = :id');
            $stmt->execute([':id' => $id]);
        }
        try {
            $log = $pdo->prepare(
                'INSERT INTO deleted_entity_log (entity_type, entity_id, parent_entity_id, deleted_by)
                 VALUES (:type, :entity_id, :parent_entity_id, :deleted_by)'
            );
            foreach ($rowsToDelete as $row) {
                $log->execute([
                    ':type' => 'op_task',
                    ':entity_id' => (int) ($row['id'] ?? 0),
                    ':parent_entity_id' => isset($row['parent_task_id']) ? (int) $row['parent_task_id'] : null,
                    ':deleted_by' => $deletedBy,
                ]);
            }
        } catch (Throwable $e) {
            // A migration 008 é opcional/gradual; exclusão não deve falhar se o log ainda não existir.
            error_log('[op_tasks.php] delete log skipped: ' . $e->getMessage());
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
    $existsStmt = $pdo->prepare('SELECT 1 FROM op_tasks WHERE id = :id');
    $existsStmt->execute([':id' => $id]);
    $isNew = $existsStmt->fetchColumn() ? false : true;
    $prevStatus = '';
    if (!$isNew) {
        $ps = $pdo->prepare('SELECT status FROM op_tasks WHERE id = :id');
        $ps->execute([':id' => $id]);
        $prevStatus = (string) ($ps->fetchColumn() ?: '');
    }
    $coord = (string) ($data['coordenadas'] ?? '');
    $locText = (string) ($data['localizacaoTexto'] ?? '');
    $descricaoRaw = (string) ($data['descricao'] ?? '');
    // DATE no MySQL: string vazia vira 0000-00-00 em modos permissivos — usar NULL.
    $prazoIn = trim((string) ($data['prazo'] ?? ''));
    $prazoBind = ($prazoIn === '' || $prazoIn === '0000-00-00') ? null : $prazoIn;
    $sql = 'INSERT INTO op_tasks (
              id, taskCode, titulo, setor, regiao, responsavel, clientesAfetados,
              coordenadas, localizacao_texto, descricao, categoria, prazo, prioridade, status,
              is_parent_task, parent_task_id, criadaEm, historico, chat_thread_key,
              nome_cliente, protocolo, data_entrada, data_instalacao, assinada_por, assinada_em
            )
            VALUES (
              :id, :taskCode, :titulo, :setor, :regiao, :responsavel, :clientesAfetados,
              :coordenadas, :localizacao_texto, :descricao, :categoria, :prazo, :prioridade, :status,
              :is_parent_task, :parent_task_id, :criadaEm, :historico, :chat_thread_key,
              :nome_cliente, :protocolo, :data_entrada, :data_instalacao, :assinada_por, :assinada_em
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
              nome_cliente = VALUES(nome_cliente),
              protocolo = VALUES(protocolo),
              data_entrada = VALUES(data_entrada),
              data_instalacao = VALUES(data_instalacao),
              assinada_por = VALUES(assinada_por),
              assinada_em = VALUES(assinada_em),
              updated_at = NOW()';
    $stmt = $pdo->prepare($sql);
    $historicoIn = $data['historico'] ?? [];
    if (!is_array($historicoIn)) {
        $historicoIn = [];
    }
    $historicoJson = json_encode($historicoIn, JSON_UNESCAPED_UNICODE);
    if ($historicoJson === false) {
        $historicoJson = '[]';
    }

    $pdo->beginTransaction();
    try {
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
            ':prazo' => $prazoBind,
            ':prioridade' => (string) ($data['prioridade'] ?? 'Média'),
            ':status' => (string) ($data['status'] ?? 'Criada'),
            ':is_parent_task' => !empty($data['isParentTask']) ? 1 : 0,
            ':parent_task_id' => isset($data['parentTaskId']) && $data['parentTaskId'] !== '' ? (int) $data['parentTaskId'] : null,
            ':criadaEm' => (string) ($data['criadaEm'] ?? date('c')),
            ':historico' => $historicoJson,
            ':chat_thread_key' => (string) ($data['chatThreadKey'] ?? ''),
            ':nome_cliente' => (string) ($data['nomeCliente'] ?? ''),
            ':protocolo' => (string) ($data['protocolo'] ?? ''),
            ':data_entrada' => (string) ($data['dataEntrada'] ?? ''),
            ':data_instalacao' => (string) ($data['dataInstalacao'] ?? ''),
            ':assinada_por' => (string) ($data['assinadaPor'] ?? ''),
            ':assinada_em' => (string) ($data['assinadaEm'] ?? ''),
        ]);

        $finalDesc = sanitizeOpTaskDescricaoHtml(processOpTaskDescricaoImages($descricaoRaw, $id, $pdo));
        pruneOpTaskImagesNotInHtml($pdo, $id, $finalDesc);
        if ($finalDesc !== $descricaoRaw) {
            $u = $pdo->prepare('UPDATE op_tasks SET descricao = :d WHERE id = :id');
            $u->execute([':d' => $finalDesc, ':id' => $id]);
        }

        // Notificação global (sininho): apenas quando for criação.
        if ($isNew) {
            $who = (string) ($_SESSION['planner_user'] ?? '');
            $cat = (string) ($data['categoria'] ?? 'rompimentos');
            $titleN = 'Nova tarefa operacional adicionada';
            $msgN = sprintf('%s: %s', $cat, (string) ($data['titulo'] ?? ''));
            $n = $pdo->prepare('INSERT INTO app_notification (kind, title, message, ref_type, ref_id, op_category, created_by)
                                VALUES (:kind, :title, :message, :ref_type, :ref_id, :op_category, :created_by)');
            $n->execute([
                ':kind' => 'task_added',
                ':title' => $titleN,
                ':message' => $msgN,
                ':ref_type' => 'op_task',
                ':ref_id' => $id,
                ':op_category' => $cat,
                ':created_by' => $who,
            ]);

            $a = $pdo->prepare('INSERT INTO app_activity_event (username, event_type, severity, message, ref_type, ref_id, op_category)
                                VALUES (:u, :t, :s, :m, :rt, :rid, :cat)');
            $a->execute([
                ':u' => $who,
                ':t' => 'op_task_created',
                ':s' => 'success',
                ':m' => sprintf('Criou uma tarefa operacional (%s): %s', $cat, (string) ($data['titulo'] ?? '')),
                ':rt' => 'op_task',
                ':rid' => $id,
                ':cat' => $cat,
            ]);
        }

        // Evento de mudança de status (para o feed do usuário).
        if (!$isNew) {
            $who = (string) ($_SESSION['planner_user'] ?? '');
            $cat = (string) ($data['categoria'] ?? '');
            $nextStatus = (string) ($data['status'] ?? '');
            if ($nextStatus !== '' && $prevStatus !== '' && $nextStatus !== $prevStatus) {
                $a2 = $pdo->prepare('INSERT INTO app_activity_event (username, event_type, severity, message, ref_type, ref_id, op_category)
                                     VALUES (:u, :t, :s, :m, :rt, :rid, :cat)');
                $a2->execute([
                    ':u' => $who,
                    ':t' => 'op_status_changed',
                    ':s' => 'info',
                    ':m' => sprintf('Alterou status (%s): %s → %s', $cat ?: 'op', $prevStatus, $nextStatus),
                    ':rt' => 'op_task',
                    ':rid' => $id,
                    ':cat' => $cat,
                ]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    jsonResponse(['ok' => true, 'descricao' => $finalDesc]);
} catch (Throwable $e) {
    // FIX: não expor mensagens internas do PDO/SQL ao cliente; logar com contexto.
    error_log('[op_tasks.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

