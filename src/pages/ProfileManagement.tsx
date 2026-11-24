import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../context/ProfileContext';
import AvatarSelector from '../components/AvatarSelector';
import { Edit, Crown, Plus, ShieldCheck, ChevronDown } from 'lucide-react';

const ProfileManagement: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profiles, updateProfile, deleteProfile, createProfile, isLoading } = useProfile();

  // Unified modal state
  const [showModal, setShowModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [modalName, setModalName] = useState('');
  const [modalAvatar, setModalAvatar] = useState('');
  const [modalAgeRestriction, setModalAgeRestriction] = useState(0);

  const [showAvatarSelector, setShowAvatarSelector] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null);

  // Custom dropdown state
  const [ageDropdownOpen, setAgeDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const ageRestrictionOptions = [
    { value: 0, label: t('profile.noRestriction'), color: 'text-green-400' },
    { value: 7, label: '7+', color: 'text-lime-400' },
    { value: 12, label: '12+', color: 'text-yellow-400' },
    { value: 16, label: '16+', color: 'text-orange-400' },
    { value: 18, label: '18+', color: 'text-red-400' },
  ];

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAgeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getAgeLabel = (value: number) => {
    return ageRestrictionOptions.find(o => o.value === value)?.label ?? t('profile.noRestriction');
  };

  const getAgeColor = (value: number) => {
    return ageRestrictionOptions.find(o => o.value === value)?.color ?? 'text-green-400';
  };

  // Open modal for editing
  const handleEditProfile = (profileId: string, currentName: string, currentAvatar: string, currentAgeRestriction?: number) => {
    setIsCreating(false);
    setEditingProfileId(profileId);
    setModalName(currentName);
    setModalAvatar(currentAvatar);
    setModalAgeRestriction(currentAgeRestriction ?? 0);
    setShowModal(true);
  };

  // Open modal for creating
  const handleOpenCreate = () => {
    setIsCreating(true);
    setEditingProfileId(null);
    setModalName('');
    setModalAvatar('');
    setModalAgeRestriction(0);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingProfileId(null);
    setIsCreating(false);
    setModalName('');
    setModalAvatar('');
    setModalAgeRestriction(0);
    setAgeDropdownOpen(false);
  };

  const handleSave = async () => {
    // Session expirée (« No auth token ») ou réseau coupé : on le dit, et la
    // fenêtre reste ouverte (GlitchTip 8707181, 8667375).
    try {
      if (isCreating) {
        if (modalName.trim() && modalAvatar) {
          await createProfile(modalName.trim(), modalAvatar, modalAgeRestriction);
          handleCloseModal();
        }
      } else if (editingProfileId && modalName.trim()) {
        await updateProfile(editingProfileId, { name: modalName.trim(), avatar: modalAvatar, ageRestriction: modalAgeRestriction });
        handleCloseModal();
      }
    } catch {
      toast.error(t('profilePage.header.saveError', 'Impossible d’enregistrer pour l’instant. Réessaie dans un moment.'));
    }
  };

  const handleDeleteProfile = (profileId: string) => {
    setShowDeleteConfirm(profileId);
  };

  const confirmDeleteProfile = async () => {
    if (showDeleteConfirm) {
      await deleteProfile(showDeleteConfirm);
      setShowDeleteConfirm(null);
    }
  };

  const cancelDeleteProfile = () => {
    setShowDeleteConfirm(null);
  };

  const handleBackToSelection = () => {
    setIsFading(true);
    setTimeout(() => {
      navigate('/profile-selection');
    }, 500);
  };

  const handleAvatarSelect = (avatarUrl: string) => {
    setModalAvatar(avatarUrl);
    setShowAvatarSelector(false);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>{t('profile.loadingProfiles')}</p>
        </div>
      </div>
    );
  }

  const currentSelectedOption = ageRestrictionOptions.find(o => o.value === modalAgeRestriction) || ageRestrictionOptions[0];

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col items-center justify-center overflow-hidden">
      <AnimatePresence mode="wait">
        {!isFading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-6xl px-4"
          >
            {/* Header */}
            <div className="text-center mb-6 xs:mb-8 sm:mb-12">
              <h1 className="text-2xl xs:text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-2 xs:mb-4">
                {t('profile.manageProfiles')}
              </h1>
            </div>

            {/* Profiles Grid */}
            <div className="flex flex-wrap justify-center gap-4 xs:gap-6 sm:gap-8 md:gap-12 mb-8 sm:mb-12">
              {profiles.map((profile) => (
                <motion.div
                  key={profile.id}
                  whileHover={{ scale: 1.02 }}
                  className="flex flex-col items-center group"
                >
                  <div className="relative group">
                    <div className="w-20 h-20 xs:w-24 xs:h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 lg:w-36 lg:h-36 xl:w-40 xl:h-40 rounded-lg overflow-hidden ring-2 xs:ring-4 ring-transparent group-hover:ring-red-600 transition-all duration-300">
                      <img
                        src={profile.avatar}
                        alt={profile.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Icône profil par défaut */}
                    {profile.isDefault && (
                      <div className="absolute -top-0.5 -right-0.5 xs:-top-1 xs:-right-1 bg-yellow-500 rounded-full p-0.5 xs:p-1 z-10">
                        <Crown className="w-2.5 h-2.5 xs:w-3 xs:h-3 text-white" />
                      </div>
                    )}

                    {/* Badge restriction d'âge */}
                    {(profile.ageRestriction ?? 0) > 0 && (
                      <div className="absolute -bottom-0.5 -right-0.5 xs:-bottom-1 xs:-right-1 bg-red-600 rounded-full px-1 xs:px-1.5 py-0.5 z-10 flex items-center gap-0.5">
                        <ShieldCheck className="w-2 h-2 xs:w-2.5 xs:h-2.5 text-white" />
                        <span className="text-[8px] xs:text-[10px] font-bold text-white">{profile.ageRestriction}+</span>
                      </div>
                    )}

                    {/* Overlay avec icône de crayon - toujours visible */}
                    <div
                      className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg cursor-pointer"
                      onClick={() => handleEditProfile(profile.id, profile.name, profile.avatar, profile.ageRestriction)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (profiles.length > 1) {
                          setShowContextMenu(profile.id);
                        }
                      }}
                      title={t('profilePage.editDeleteTooltip')}
                    >
                      <Edit className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                  </div>

                  <div className="mt-2 xs:mt-3 sm:mt-4 w-full max-w-xs">
                    <p className="text-sm xs:text-base sm:text-lg md:text-xl text-gray-300 group-hover:text-white transition-colors text-center">
                      {profile.name}
                    </p>
                    {/* Afficher la restriction d'âge sous le nom */}
                    {(profile.ageRestriction ?? 0) > 0 && (
                      <p className="text-[10px] xs:text-xs text-red-400 text-center mt-0.5 flex items-center justify-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        {profile.ageRestriction}+
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}

              {/* Add Profile Button */}
              {profiles.length < 5 && (
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="flex flex-col items-center group"
                >
                  <div className="relative">
                    <div className="w-20 h-20 xs:w-24 xs:h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 lg:w-36 lg:h-36 xl:w-40 xl:h-40 rounded-lg border-2 border-dashed border-gray-600 flex items-center justify-center group-hover:border-red-600 transition-colors cursor-pointer"
                      onClick={handleOpenCreate}
                    >
                      <Plus className="w-6 h-6 xs:w-8 xs:h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-gray-400 group-hover:text-red-600 transition-colors" />
                    </div>
                  </div>

                  <div className="mt-2 xs:mt-3 sm:mt-4 w-full max-w-xs">
                    <p className="text-sm xs:text-base sm:text-lg md:text-xl text-gray-300 group-hover:text-white transition-colors text-center">
                      {t('profile.addProfile')}
                    </p>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Done Button */}
            <div className="text-center">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleBackToSelection}
                className="px-8 py-3 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                {t('common.done')}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu for Delete */}
      <AnimatePresence>
        {showContextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 flex items-center justify-center p-4 z-[100000]"
            onClick={() => setShowContextMenu(null)}
          >
            <motion.div
              className="bg-gray-900 rounded-lg p-4 border border-gray-700"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-white mb-3 text-center">{t('profile.deleteProfileConfirm')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowContextMenu(null)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    handleDeleteProfile(showContextMenu);
                    setShowContextMenu(null);
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                >
                  {t('common.delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-2 sm:p-4 z-[100000]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowDeleteConfirm(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
               <div className="text-center">
                 <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                   <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                   </svg>
                 </div>
                 <h3 className="text-xl font-bold text-white mb-2">{t('profile.deleteProfile')}</h3>
                 <p className="text-gray-400 mb-6">
                   {t('profile.deleteProfileWarning')}
                 </p>
                 <div className="flex gap-3">
                   <motion.button
                     whileHover={{ scale: 1.05 }}
                     whileTap={{ scale: 0.95 }}
                     onClick={cancelDeleteProfile}
                     className="flex-1 px-4 py-2 border border-gray-600 rounded-lg hover:border-white transition-colors"
                   >
                     {t('common.cancel')}
                   </motion.button>
                   <motion.button
                     whileHover={{ scale: 1.05 }}
                     whileTap={{ scale: 0.95 }}
                     onClick={confirmDeleteProfile}
                     className="flex-1 px-4 py-2 border border-red-600 rounded-lg hover:border-red-500 transition-colors"
                   >
                     {t('common.delete')}
                   </motion.button>
                 </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Create/Edit Profile Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-2 sm:p-4 z-[100000]"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseModal();
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-gray-900 rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <h3 className="text-lg sm:text-xl font-bold text-white mb-4 sm:mb-6">
                {isCreating ? t('profile.createProfile') : t('profile.editProfile')}
              </h3>

              <div className="space-y-4 sm:space-y-6">
                {/* Avatar section with big badges */}
                <div className="flex flex-col items-center">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    {t('profile.profilePhoto')}
                  </label>
                  <div className="relative">
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden cursor-pointer border-2 border-gray-600 hover:border-red-600 transition-colors"
                      onClick={() => setShowAvatarSelector(true)}
                    >
                      {modalAvatar ? (
                        <img
                          src={modalAvatar}
                          alt={t('profile.selectedAvatar')}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        </div>
                      )}
                    </motion.div>

                    {/* Big crown badge for default profile */}
                    {!isCreating && editingProfileId && profiles.find(p => p.id === editingProfileId)?.isDefault && (
                      <div className="absolute -top-2 -right-2 bg-yellow-500 rounded-full p-2 shadow-lg shadow-yellow-500/40">
                        <Crown className="w-6 h-6 text-white" />
                      </div>
                    )}

                    {/* Big age restriction badge */}
                    {modalAgeRestriction > 0 && (
                      <div className="absolute -bottom-2 -right-2 bg-red-600 rounded-full px-2.5 py-1 z-10 flex items-center gap-1 shadow-lg shadow-red-600/40">
                        <ShieldCheck className="w-4 h-4 text-white" />
                        <span className="text-sm font-bold text-white">{modalAgeRestriction}+</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Nom d'utilisateur */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('profile.username')}
                  </label>
                  <input
                    type="text"
                    value={modalName}
                    onChange={(e) => setModalName(e.target.value)}
                    placeholder={t('profile.enterName')}
                    className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    maxLength={20}
                  />
                </div>

                {/* Restriction d'âge - Custom dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('profile.ageRestriction')}
                  </label>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setAgeDropdownOpen(!ageDropdownOpen)}
                      className="w-full p-3 bg-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-600 flex items-center justify-between cursor-pointer hover:bg-gray-750 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldCheck className={`w-4 h-4 ${currentSelectedOption.color}`} />
                        <span>{currentSelectedOption.label}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${ageDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                      {ageDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden z-50 shadow-xl"
                        >
                          {ageRestrictionOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setModalAgeRestriction(option.value);
                                setAgeDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 flex items-center gap-2 hover:bg-gray-700 transition-colors text-left ${
                                modalAgeRestriction === option.value ? 'bg-gray-700/50' : ''
                              }`}
                            >
                              <ShieldCheck className={`w-4 h-4 ${option.color}`} />
                              <span className="text-white">{option.label}</span>
                              {modalAgeRestriction === option.value && (
                                <span className="ml-auto text-red-500 text-sm">&#10003;</span>
                              )}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{t('profile.ageRestrictionDesc')}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-6">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 border border-gray-600 rounded-lg hover:border-white transition-colors"
                >
                  {t('common.cancel')}
                </motion.button>
                {!isCreating && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      if (editingProfileId && profiles.length > 1) {
                        setShowModal(false);
                        setShowDeleteConfirm(editingProfileId);
                      }
                    }}
                    disabled={profiles.length === 1}
                    className="flex-1 px-4 py-2 border border-red-600 rounded-lg hover:border-red-500 disabled:border-gray-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('common.delete')}
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSave}
                  disabled={!modalName.trim() || (!modalAvatar && isCreating)}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  {isCreating ? t('common.create') : t('common.save')}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Avatar Selector */}
      {showAvatarSelector && (
        <AvatarSelector
          isOpen={showAvatarSelector}
          onClose={() => setShowAvatarSelector(false)}
          onAvatarSelect={handleAvatarSelect}
          currentAvatar={modalAvatar}
        />
      )}
    </div>
  );
};

export default ProfileManagement;
