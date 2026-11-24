'use strict';

// Onglet « IA » de la modération des commentaires : fournisseur (Claude
// Platform, OpenRouter ou aucun), modèle, effort, clés API et essai sur un
// texte. Les clés ne repartent jamais en clair vers le navigateur.

const express = require('express');
const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const settingsStore = require('../utils/commentsAiSettings');
const commentsAi = require('../utils/commentsAi');

const router = express.Router();
const TEST_CONTENT_MAX_LENGTH = 500;

function setNoStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function toPayload(loaded) {
  return {
    success: true,
    settings: settingsStore.toAdminView(loaded.settings),
    updatedAt: loaded.updatedAt,
    updatedBy: loaded.updatedBy,
    options: {
      claudeModels: commentsAi.CLAUDE_MODEL_CHOICES.map(({ id, label }) => ({
        id,
        label,
        ...commentsAi.typicalClaudeCosts(id)
      })),
      claudeEfforts: settingsStore.CLAUDE_EFFORTS,
      openrouterEfforts: settingsStore.OPENROUTER_EFFORTS,
      claudeSdkInstalled: commentsAi.isClaudeSdkInstalled()
    }
  };
}

router.get('/admin/comments-ai', setNoStore, isAdmin, async (_req, res) => {
  try {
    return res.json(toPayload(await settingsStore.loadCommentsAiSettings(getPool(), { fresh: true })));
  } catch (error) {
    console.error('[IA commentaires] Lecture des réglages impossible :', error);
    return res.status(500).json({ success: false, error: 'Impossible de lire les réglages de l\'IA' });
  }
});

router.put('/admin/comments-ai', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const current = await settingsStore.loadCommentsAiSettings(pool, { fresh: true });
    const next = settingsStore.validateSettingsInput(req.body?.settings, current.settings);
    const saved = await settingsStore.saveCommentsAiSettings(pool, next, req.admin?.userId || null);
    console.log(
      `[IA commentaires] Réglages modifiés par l'admin ${req.admin?.adminId ?? '?'} : ${next.provider}`
    );
    return res.json(toPayload(saved));
  } catch (error) {
    if (error?.code === settingsStore.COMMENTS_AI_ERROR_CODES.settingsInvalid) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('[IA commentaires] Enregistrement impossible :', error);
    return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer les réglages de l\'IA' });
  }
});

// Analyse un texte avec les réglages enregistrés, sans rien écrire en base.
// Sert aussi à vérifier une clé : l'appel est facturé comme un commentaire.
router.post('/admin/comments-ai/test', setNoStore, isAdmin, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content || content.length > TEST_CONTENT_MAX_LENGTH) {
    return res.status(400).json({ success: false, error: `Le texte doit faire entre 1 et ${TEST_CONTENT_MAX_LENGTH} caractères.` });
  }
  const provider = ['claude', 'openrouter'].includes(body.provider) ? body.provider : null;
  if (!provider) {
    return res.status(400).json({ success: false, error: 'Fournisseur à tester inconnu.' });
  }
  const work = ['movie', 'tv'].includes(body.mediaType) && /^\d{1,10}$/.test(String(body.mediaId ?? ''))
    ? { mediaType: body.mediaType, mediaId: String(body.mediaId) }
    : null;

  try {
    const config = await settingsStore.loadCommentsAiConfig(getPool());
    const result = await commentsAi.analyzeComment({ username: 'Test admin', content, work }, config, { provider });
    return res.json({
      success: true,
      result: {
        provider: result.provider,
        model: result.model,
        decision: result.decision,
        usage: result.usage,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        stopReason: result.stopReason || null,
        error: result.error
      }
    });
  } catch (error) {
    console.error('[IA commentaires] Essai impossible :', error);
    return res.status(500).json({ success: false, error: 'Essai impossible' });
  }
});

module.exports = router;
