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
    $action = strtolower(trim((string) ($_GET['action'] ?? 'listar')));
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    $asIso = static function (?string $dt): ?string {
        if ($dt === null) return null;
        $s = trim($dt);
        if ($s === '') return null;
        // Aceita "YYYY-MM-DDTHH:mm" do input datetime-local e "YYYY-MM-DD HH:mm:ss"
        $s = str_replace('T', ' ', $s);
        // Normaliza segundos
        if (preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/', $s)) {
            $s .= ':00';
        }
        return $s;
    };

    $assertDt = static function (?string $dt, string $field) use ($asIso): string {
        $v = $asIso($dt);
        if (!$v) {
            jsonResponse(['ok' => false, 'error' => "$field invalido"], 422);
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $v)) {
            jsonResponse(['ok' => false, 'error' => "$field invalido"], 422);
        }
        return $v;
    };

    if ($method === 'GET' && $action === 'listar') {
        $mes = (int) ($_GET['mes'] ?? 0);
        $ano = (int) ($_GET['ano'] ?? 0);
        if ($mes < 1 || $mes > 12 || $ano < 1970 || $ano > 2100) {
            jsonResponse(['ok' => false, 'error' => 'mes/ano invalidos'], 422);
        }
        $start = sprintf('%04d-%02d-01 00:00:00', $ano, $mes);
        $endDt = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $ano, $mes));
        $endDt = $endDt->modify('first day of next month');
        $end = $endDt->format('Y-m-d H:i:s');

        $stmt = $pdo->prepare(
            'SELECT id, titulo, descricao, data_inicio AS data_inicio, data_fim AS data_fim, categoria, criado_em AS criado_em
             FROM eventos
             WHERE data_inicio >= :start AND data_inicio < :end
             ORDER BY data_inicio ASC, id ASC'
        );
        $stmt->execute([':start' => $start, ':end' => $end]);
        jsonResponse(['ok' => true, 'eventos' => $stmt->fetchAll() ?: []]);
    }

    if ($method === 'GET' && $action === 'buscar') {
        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q === '') {
            jsonResponse(['ok' => true, 'eventos' => []]);
        }
        $stmt = $pdo->prepare(
            'SELECT id, titulo, descricao, data_inicio AS data_inicio, data_fim AS data_fim, categoria, criado_em AS criado_em
             FROM eventos
             WHERE titulo LIKE :q
             ORDER BY data_inicio DESC, id DESC
             LIMIT 80'
        );
        $stmt->execute([':q' => '%' . $q . '%']);
        jsonResponse(['ok' => true, 'eventos' => $stmt->fetchAll() ?: []]);
    }

    if ($method === 'GET' && $action === 'proximos') {
        $lim = (int) ($_GET['limite'] ?? 5);
        if ($lim <= 0) $lim = 5;
        if ($lim > 50) $lim = 50;
        $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'SELECT id, titulo, descricao, data_inicio AS data_inicio, data_fim AS data_fim, categoria, criado_em AS criado_em
             FROM eventos
             WHERE data_inicio >= :now
             ORDER BY data_inicio ASC, id ASC
             LIMIT ' . $lim
        );
        $stmt->execute([':now' => $now]);
        jsonResponse(['ok' => true, 'eventos' => $stmt->fetchAll() ?: []]);
    }

    if ($action === 'criar' && $method === 'POST') {
        $data = readJsonBody();
        $titulo = trim((string) ($data['titulo'] ?? ''));
        if ($titulo === '') jsonResponse(['ok' => false, 'error' => 'titulo invalido'], 422);
        $inicio = $assertDt((string) ($data['data_inicio'] ?? ''), 'data_inicio');
        $fimRaw = $asIso((string) ($data['data_fim'] ?? ''));
        $fim = $fimRaw && preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $fimRaw) ? $fimRaw : null;
        $categoria = trim((string) ($data['categoria'] ?? 'Em andamento')) ?: 'Em andamento';
        $descricao = (string) ($data['descricao'] ?? '');

        $stmt = $pdo->prepare(
            'INSERT INTO eventos (titulo, descricao, data_inicio, data_fim, categoria)
             VALUES (:t, :d, :i, :f, :c)'
        );
        $stmt->execute([':t' => $titulo, ':d' => $descricao, ':i' => $inicio, ':f' => $fim, ':c' => $categoria]);
        $id = (int) $pdo->lastInsertId();

        $row = $pdo->prepare('SELECT id, titulo, descricao, data_inicio, data_fim, categoria, criado_em FROM eventos WHERE id = :id');
        $row->execute([':id' => $id]);
        jsonResponse(['ok' => true, 'evento' => $row->fetch() ?: null]);
    }

    if ($action === 'editar' && $method === 'PUT') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        $data = readJsonBody();

        $titulo = trim((string) ($data['titulo'] ?? ''));
        if ($titulo === '') jsonResponse(['ok' => false, 'error' => 'titulo invalido'], 422);
        $inicio = $assertDt((string) ($data['data_inicio'] ?? ''), 'data_inicio');
        $fimRaw = $asIso((string) ($data['data_fim'] ?? ''));
        $fim = $fimRaw && preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/', $fimRaw) ? $fimRaw : null;
        $categoria = trim((string) ($data['categoria'] ?? 'Em andamento')) ?: 'Em andamento';
        $descricao = (string) ($data['descricao'] ?? '');

        $stmt = $pdo->prepare(
            'UPDATE eventos
             SET titulo = :t, descricao = :d, data_inicio = :i, data_fim = :f, categoria = :c
             WHERE id = :id'
        );
        $stmt->execute([':t' => $titulo, ':d' => $descricao, ':i' => $inicio, ':f' => $fim, ':c' => $categoria, ':id' => $id]);

        $row = $pdo->prepare('SELECT id, titulo, descricao, data_inicio, data_fim, categoria, criado_em FROM eventos WHERE id = :id');
        $row->execute([':id' => $id]);
        jsonResponse(['ok' => true, 'evento' => $row->fetch() ?: null]);
    }

    if ($action === 'excluir' && $method === 'DELETE') {
        $id = (int) ($_GET['id'] ?? 0);
        if ($id <= 0) jsonResponse(['ok' => false, 'error' => 'id invalido'], 422);
        $stmt = $pdo->prepare('DELETE FROM eventos WHERE id = :id');
        $stmt->execute([':id' => $id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['ok' => false, 'error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    error_log('[eventos.php] failed: ' . $e->getMessage());
    jsonResponse(['ok' => false, 'error' => 'server_error'], 500);
}

