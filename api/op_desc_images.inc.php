<?php
declare(strict_types=1);

/**
 * Extrai imagens em data URL de tags <img> na descrição, grava em op_task_image e substitui o src.
 * Retorna HTML final referenciando op_task_image.php?id=...
 */
function processOpTaskDescricaoImages(string $html, int $opTaskId, PDO $pdo): string
{
    if ($html === '' || $opTaskId <= 0) {
        return $html;
    }

    $maxBytes = 8 * 1024 * 1024; // 8 MB por imagem (após decode)

    return (string) preg_replace_callback(
        '/<img\b[^>]*\bsrc\s*=\s*["\'](data:image\/(png|jpeg|jpg|gif|webp);base64,([^"\']+))["\'][^>]*>/i',
        function (array $m) use ($opTaskId, $pdo, $maxBytes): string {
            $rawB64 = $m[3];
            $binary = base64_decode((string) preg_replace('/\s+/', '', $rawB64), true);
            if ($binary === false || $binary === '') {
                return $m[0];
            }
            if (strlen($binary) > $maxBytes) {
                return $m[0];
            }

            $ext = strtolower($m[2]);
            if ($ext === 'jpg') {
                $ext = 'jpeg';
            }
            $mime = 'image/' . $ext;
            $info = @getimagesizefromstring($binary);
            if (!is_array($info) || empty($info['mime']) || strtolower((string) $info['mime']) !== $mime) {
                return '';
            }

            $usage = $pdo->prepare('SELECT COUNT(*) AS total_images, COALESCE(SUM(OCTET_LENGTH(image_data)), 0) AS total_bytes FROM op_task_image WHERE op_task_id = :task');
            $usage->execute([':task' => $opTaskId]);
            $current = $usage->fetch() ?: [];
            $totalImages = (int) ($current['total_images'] ?? 0);
            $totalBytes = (int) ($current['total_bytes'] ?? 0);
            if ($totalImages >= 20 || ($totalBytes + strlen($binary)) > (40 * 1024 * 1024)) {
                return '';
            }

            $stmt = $pdo->prepare(
                'INSERT INTO op_task_image (op_task_id, mime_type, image_data) VALUES (:task, :mime, :data)'
            );
            $stmt->execute([
                ':task' => $opTaskId,
                ':mime' => $mime,
                ':data' => $binary,
            ]);
            $newId = (int) $pdo->lastInsertId();
            $src = 'api/op_task_image.php?id=' . $newId;

            return '<img src="' . htmlspecialchars($src, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '" alt="" data-op-img-id="' . $newId . '" />';
        },
        $html
    );
}

/**
 * Sanitiza o HTML rico salvo na descrição.
 * Mantém apenas tags/atributos necessários para texto, links e imagens do próprio endpoint.
 */
function sanitizeOpTaskDescricaoHtml(string $html): string
{
    $html = trim($html);
    if ($html === '') {
        return '';
    }

    if (!class_exists('DOMDocument')) {
        return strip_tags($html, '<p><br><b><strong><i><em><u><ul><ol><li><div><span><img><a>');
    }

    $allowedTags = [
        'a' => ['href', 'title', 'target', 'rel'],
        'b' => [],
        'br' => [],
        'div' => ['class'],
        'em' => [],
        'i' => [],
        'img' => ['src', 'alt', 'title', 'data-op-img-id'],
        'li' => [],
        'ol' => [],
        'p' => [],
        'span' => ['class', 'data-op-img-id'],
        'strong' => [],
        'u' => [],
        'ul' => [],
    ];

    $doc = new DOMDocument('1.0', 'UTF-8');
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8"><div id="__root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();

    $sanitizeNode = function (DOMNode $node) use (&$sanitizeNode, $allowedTags): void {
        if ($node instanceof DOMElement) {
            $tag = strtolower($node->tagName);
            if ($tag === 'script' || $tag === 'style' || $tag === 'iframe' || $tag === 'object' || $tag === 'embed' || $tag === 'svg' || $tag === 'math') {
                $node->parentNode?->removeChild($node);
                return;
            }

            if (!array_key_exists($tag, $allowedTags) && $node->getAttribute('id') !== '__root') {
                $text = $node->ownerDocument->createTextNode($node->textContent ?? '');
                $node->parentNode?->replaceChild($text, $node);
                return;
            }

            $allowedAttrs = $allowedTags[$tag] ?? [];
            for ($i = $node->attributes->length - 1; $i >= 0; $i--) {
                $attr = $node->attributes->item($i);
                if (!$attr) {
                    continue;
                }
                $name = strtolower($attr->name);
                $value = trim($attr->value);
                if (str_starts_with($name, 'on') || !in_array($name, $allowedAttrs, true)) {
                    $node->removeAttribute($attr->name);
                    continue;
                }
                if (($name === 'href' || $name === 'src') && preg_match('/^\s*javascript:/i', $value)) {
                    $node->removeAttribute($attr->name);
                    continue;
                }
                if ($tag === 'img' && $name === 'src' && !preg_match('#^(api/)?op_task_image\.php\?id=\d+$#i', $value)) {
                    $node->removeAttribute($attr->name);
                }
                if ($tag === 'a' && $name === 'href' && !preg_match('#^https?://#i', $value)) {
                    $node->removeAttribute($attr->name);
                }
            }

            if ($tag === 'a' && $node->hasAttribute('href')) {
                $node->setAttribute('target', '_blank');
                $node->setAttribute('rel', 'noopener noreferrer');
            }
        }

        foreach (iterator_to_array($node->childNodes) as $child) {
            $sanitizeNode($child);
        }
    };

    $root = $doc->getElementById('__root');
    if (!$root) {
        return '';
    }
    $sanitizeNode($root);

    $out = '';
    foreach ($root->childNodes as $child) {
        $out .= $doc->saveHTML($child);
    }

    return trim($out);
}

/**
 * Remove registros de imagem que não aparecem mais no HTML da descrição.
 */
function pruneOpTaskImagesNotInHtml(PDO $pdo, int $opTaskId, string $html): void
{
    if ($opTaskId <= 0) {
        return;
    }

    preg_match_all('/(?:op_task_image\.php\?id=|data-op-img-id=")(\d+)/', $html, $matches);
    $keep = [];
    foreach ($matches[1] ?? [] as $v) {
        $n = (int) $v;
        if ($n > 0) {
            $keep[$n] = true;
        }
    }

    if (empty($keep)) {
        $stmt = $pdo->prepare('DELETE FROM op_task_image WHERE op_task_id = :tid');
        $stmt->execute([':tid' => $opTaskId]);

        return;
    }

    $ids = array_keys($keep);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $sql = "DELETE FROM op_task_image WHERE op_task_id = ? AND id NOT IN ($placeholders)";
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_merge([$opTaskId], $ids));
}
