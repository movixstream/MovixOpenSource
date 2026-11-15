/**
 * Profile management routes.
 * Extracted from server.js -- CRUD operations for user profiles.
 * Mount point: app.use('/api/profiles', router)
 */

const express = require('express');
const router = express.Router();
const fsp = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const { getAuthIfValid } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const {
  ensureSafeProfileId,
  getOwnedProfile,
  getProfileFilePath,
  sanitizeProfileData,
  SyncPolicyError,
  validateProfileName
} = require('../utils/syncPolicy');

// Lazy imports from sync module to avoid circular dependencies
let _syncModule = null;
function getSyncModule() {
  if (!_syncModule) _syncModule = require('./sync');
  return _syncModule;
}

// === Routes ===

// GET / - Get all profiles for authenticated user
router.get('/', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { readUserData } = getSyncModule();
    const userData = await readUserData(auth.userType, auth.userId);
    const profiles = userData.profiles || [];

    res.status(200).json({ success: true, profiles });
  } catch (error) {
    console.error('Error getting profiles:', error);
    res.status(500).json({ error: 'Failed to get profiles' });
  }
});

// POST / - Create new profile (max 5 per user)
router.post('/', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, avatar, ageRestriction } = req.body;
    if (!name || !avatar) return res.status(400).json({ error: 'Name and avatar are required' });
    if (avatar && !avatar.startsWith('/avatars/') && avatar !== '') {
      return res.status(400).json({ error: 'Invalid avatar URL. Must be a local path starting with /avatars/' });
    }
    let safeName;
    try {
      safeName = validateProfileName(name);
    } catch (e) {
      if (e instanceof SyncPolicyError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
    const validAgeRestrictions = [0, 7, 12, 16, 18];
    const ageRestrictionValue = validAgeRestrictions.includes(Number(ageRestriction)) ? Number(ageRestriction) : 0;

    const { readUserData, writeUserData } = getSyncModule();
    const userData = await readUserData(auth.userType, auth.userId);
    const profiles = userData.profiles || [];

    if (profiles.length >= 5) return res.status(400).json({ error: 'Maximum 5 profiles allowed' });

    const profileId = uuidv4();
    const newProfile = {
      id: profileId,
      name: safeName,
      avatar,
      ageRestriction: ageRestrictionValue,
      createdAt: new Date().toISOString(),
      isDefault: profiles.length === 0
    };

    userData.profiles = [...profiles, newProfile];
    userData.lastUpdated = Date.now();

    const success = await writeUserData(auth.userType, auth.userId, userData);
    if (!success) return res.status(500).json({ error: 'Failed to create profile' });

    res.status(200).json({ success: true, profile: newProfile });
  } catch (error) {
    console.error('Error creating profile:', error);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// PUT /:profileId - Update profile (name, avatar)
router.put('/:profileId', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profileId = ensureSafeProfileId(req.params.profileId);
    const { name, avatar, ageRestriction } = req.body;
    if (!name && !avatar && ageRestriction === undefined) return res.status(400).json({ error: 'Name, avatar, or ageRestriction is required' });
    if (avatar && !avatar.startsWith('/avatars/') && avatar !== '') {
      return res.status(400).json({ error: 'Invalid avatar URL. Must be a local path starting with /avatars/' });
    }

    const { readUserData, writeUserData } = getSyncModule();
    const userData = await readUserData(auth.userType, auth.userId);
    const profiles = userData.profiles || [];

    const profileIndex = profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) return res.status(404).json({ error: 'Profile not found' });

    if (name) {
      try {
        profiles[profileIndex].name = validateProfileName(name);
      } catch (e) {
        if (e instanceof SyncPolicyError) return res.status(e.status).json({ error: e.message, code: e.code });
        throw e;
      }
    }
    if (avatar) profiles[profileIndex].avatar = avatar;
    if (ageRestriction !== undefined) {
      const validAgeRestrictions = [0, 7, 12, 16, 18];
      profiles[profileIndex].ageRestriction = validAgeRestrictions.includes(Number(ageRestriction)) ? Number(ageRestriction) : 0;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(auth.userType, auth.userId, userData);
    if (!success) return res.status(500).json({ error: 'Failed to update profile' });

    res.status(200).json({ success: true, profile: profiles[profileIndex] });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// DELETE /:profileId - Delete profile (except last one)
router.delete('/:profileId', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profileId = ensureSafeProfileId(req.params.profileId);
    const { readUserData, writeUserData, deleteProfileHistory, USERS_DIR } = getSyncModule();
    const userData = await readUserData(auth.userType, auth.userId);
    const profiles = userData.profiles || [];

    const isLastProfile = profiles.length <= 1;
    const profileIndex = profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) return res.status(404).json({ error: 'Profile not found' });

    const wasDefault = profiles[profileIndex]?.isDefault;
    profiles.splice(profileIndex, 1);

    if (isLastProfile) {
      let defaultName = 'Profil';
      let defaultAvatar = '/avatars/disney/disney_avatar_1.png';

      if (auth.userType === 'bip39' && userData.auth) {
        try {
          const authData = JSON.parse(userData.auth);
          if (authData.userProfile) {
            defaultName = authData.userProfile.username || 'Profil';
            defaultAvatar = authData.userProfile.avatar || defaultAvatar;
          }
        } catch (e) {
          console.log('Could not parse auth data for new default profile');
        }
      }

      const newProfileId = uuidv4();
      const newDefaultProfile = {
        id: newProfileId, name: defaultName, avatar: defaultAvatar,
        createdAt: new Date().toISOString(), isDefault: true
      };
      profiles.push(newDefaultProfile);
    } else if (wasDefault && profiles.length > 0) {
      profiles[0].isDefault = true;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(auth.userType, auth.userId, userData);
    if (!success) return res.status(500).json({ error: 'Failed to delete profile' });

    // Delete profile data file
    const profilePath = getProfileFilePath(USERS_DIR, auth.userType, auth.userId, profileId);
    try { await fsp.unlink(profilePath); } catch (e) { /* Ignore if file doesn't exist */ }

    // Historique et progression du profil (au mieux, ne lève jamais).
    await deleteProfileHistory(auth.userType, auth.userId, profileId);

    // Delete associated votes (likes/dislikes) for this profile
    try {
      const pool = getPool();
      if (pool) {
        await pool.execute(
          'DELETE FROM likes WHERE user_id = ? AND user_type = ? AND profile_id = ?',
          [auth.userId, auth.userType, profileId]
        );
      }
    } catch (e) {
      console.error('Error deleting profile votes:', e.message);
    }

    res.status(200).json({ success: true, newDefaultProfile: isLastProfile ? profiles[profiles.length - 1] : null });
  } catch (error) {
    console.error('Error deleting profile:', error);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// GET /:profileId/data - Get profile-specific data
router.get('/:profileId/data', async (req, res) => {
  try {
    const sync = getSyncModule();
    if (sync.isShuttingDown && sync.isShuttingDown()) return res.status(503).json({ error: 'Server is shutting down' });
    sync.startOperation();

    try {
      const auth = await getAuthIfValid(req);
      if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const profileId = ensureSafeProfileId(req.params.profileId);

      const userData = await sync.readUserData(auth.userType, auth.userId);
      getOwnedProfile(userData, profileId);

      const profileData = await sync.readProfileData(auth.userType, auth.userId, profileId);
      res.status(200).json({ success: true, data: profileData });
    } finally {
      sync.endOperation();
    }
  } catch (error) {
    console.error('Error getting profile data:', error);
    res.status(500).json({ error: 'Failed to get profile data' });
  }
});

// POST /migrate - Migrate existing user data to default profile
router.post('/migrate', async (req, res) => {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userData } = req.body;
    const { readUserData, writeUserData, writeProfileData } = getSyncModule();

    const existingUserData = await readUserData(auth.userType, auth.userId);
    if (existingUserData.profiles && existingUserData.profiles.length > 0) {
      return res.status(400).json({ error: 'User already has profiles' });
    }

    let defaultName = 'Profil';
    let defaultAvatar = '/avatars/disney/disney_avatar_1.png';

    if (auth.userType === 'bip39' && existingUserData.auth) {
      try {
        const authData = JSON.parse(existingUserData.auth);
        if (authData.userProfile) {
          defaultName = authData.userProfile.username || 'Profil';
          defaultAvatar = authData.userProfile.avatar || defaultAvatar;
        }
      } catch (e) { console.log('Could not parse auth data for default profile'); }
    }

    const profileId = uuidv4();
    const defaultProfile = {
      id: profileId, name: defaultName, avatar: defaultAvatar,
      createdAt: new Date().toISOString(), isDefault: true
    };

    const { data: profileData } = sanitizeProfileData(userData);

    const profileSuccess = await writeProfileData(auth.userType, auth.userId, profileId, profileData);
    if (!profileSuccess) return res.status(500).json({ error: 'Failed to save profile data' });

    existingUserData.profiles = [defaultProfile];
    existingUserData.lastUpdated = Date.now();

    const userSuccess = await writeUserData(auth.userType, auth.userId, existingUserData);
    if (!userSuccess) return res.status(500).json({ error: 'Failed to save user data' });

    res.status(200).json({ success: true, profile: defaultProfile });
  } catch (error) {
    console.error('Error migrating profile:', error);
    res.status(500).json({ error: 'Failed to migrate profile' });
  }
});

module.exports = router;
