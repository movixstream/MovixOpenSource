import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, FolderPlus, X } from 'lucide-react';

interface AddToListMenuProps {
  mediaId: number;
  mediaType: 'movie' | 'tv' | 'collection';
  title: string;
  posterPath: string;
  onClose: () => void;
  movieCount?: number; // Nombre de films dans la collection
}

const AddToListMenu: React.FC<AddToListMenuProps> = ({
  mediaId,
  mediaType,
  title,
  posterPath,
  onClose,
  movieCount
}) => {
  console.log('AddToListMenu rendered with:', { mediaId, mediaType, title, posterPath });
  
  const { t } = useTranslation();
  const [lists, setLists] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [addedToList, setAddedToList] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isClosingCreateForm, setIsClosingCreateForm] = useState(false);

  useEffect(() => {
    const savedLists = JSON.parse(localStorage.getItem('custom_lists') || '[]');
    setLists(savedLists);
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const handleCloseCreateForm = () => {
    setIsClosingCreateForm(true);
    setTimeout(() => {
      setShowCreateForm(false);
      setIsClosingCreateForm(false);
    }, 300);
  };

  // Les ids de liste peuvent être des nombres (créées depuis le profil) ou
  // des chaînes (créées ici) : on compare toujours en chaîne.
  const handleAddToList = (rawListId: string | number) => {
    const listId = String(rawListId);
    console.log('Adding to list:', listId, { mediaId, mediaType, title, posterPath });

    const updatedLists = lists.map(list => {
      if (String(list.id) === listId) {
        const itemExists = (list.items ?? []).some((item: any) => 
          item.id === mediaId && item.type === mediaType
        );

        if (!itemExists) {
          return {
            ...list,
            items: [
              {
                id: mediaId,
                type: mediaType,
                title,
                poster_path: posterPath,
                addedAt: new Date().toISOString()
              },
              ...list.items
            ]
          };
        }
      }
      return list;
    });

    localStorage.setItem('custom_lists', JSON.stringify(updatedLists));
    setLists(updatedLists);
    
    // Afficher le feedback visuel
    setAddedToList(listId);
    
    // Fermer le menu après l'ajout
    setTimeout(() => {
      handleClose();
    }, 1000);
  };

  const handleCreateList = () => {
    if (newListName.trim()) {
      const newList = {
        id: Date.now().toString(),
        name: newListName.trim(),
        items: [{
          id: mediaId,
          type: mediaType,
          title,
          poster_path: posterPath,
          addedAt: new Date().toISOString()
        }],
        createdAt: new Date().toISOString()
      };

      const updatedLists = [...lists, newList];
      localStorage.setItem('custom_lists', JSON.stringify(updatedLists));
      setLists(updatedLists);
      setNewListName('');
      setShowCreateForm(false);
    }
  };

  const handleCreateCollectionList = () => {
    if (mediaType === 'collection') {
      // Créer une nouvelle liste dans custom_lists avec le nom de la collection
      const newList = {
        id: Date.now().toString(),
        name: title,
        items: [{
          id: mediaId,
          type: mediaType,
          title,
          poster_path: posterPath,
          addedAt: new Date().toISOString()
        }],
        createdAt: new Date().toISOString()
      };

      const updatedLists = [...lists, newList];
      localStorage.setItem('custom_lists', JSON.stringify(updatedLists));
      setLists(updatedLists);
      
      // Afficher le feedback visuel
      setAddedToList(newList.id);
      
      // Fermer le menu après l'ajout
      setTimeout(() => {
        handleClose();
      }, 1000);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {!isClosing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100000]"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-gray-800 rounded-2xl p-6 w-full max-w-md relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">{t('lists.addToList')}</h2>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
        
        {/* Bouton spécial pour créer une liste avec le nom de la collection */}
        {mediaType === 'collection' && !lists.some(list => list.name === title) && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCreateCollectionList}
            disabled={addedToList !== null}
            className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg transition-colors mb-4 ${
              addedToList !== null
                ? 'bg-green-600 text-white cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}
          >
            <FolderPlus className="w-4 h-4" />
            {t('lists.createListNamed', { name: title })}
            {!!movieCount && <span className="text-sm opacity-75">({movieCount} {t('lists.movies')})</span>}
          </motion.button>
        )}
        
        {addedToList && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-green-600/20 border border-green-500/30 rounded-lg text-green-400 text-sm"
          >
            ✓ {t('lists.addedSuccess')}
          </motion.div>
        )}
        
        {lists.length === 0 ? (
          <div className="text-center py-8">
            <FolderPlus className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">{t('lists.noLists')}</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              {t('lists.createFirstList')}
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {lists.map(list => (
                <button
                  key={list.id}
                  onClick={() => handleAddToList(list.id)}
                  disabled={addedToList === String(list.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                    addedToList === String(list.id)
                      ? 'bg-green-600 text-white cursor-not-allowed' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  <span>{list.name}</span>
                  {(list.items ?? []).some((item: any) => item.id === mediaId && item.type === mediaType) || addedToList === String(list.id) ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-700">
              <button
                onClick={() => setShowCreateForm(true)}
                className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
                {t('lists.createNewList')}
              </button>
            </div>
          </>
        )}

        {showCreateForm && (
          <AnimatePresence mode="wait">
            {!isClosingCreateForm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100001]"
                onClick={handleCloseCreateForm}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm relative"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-white">{t('lists.createNewList')}</h3>
                    <button
                      onClick={handleCloseCreateForm}
                      className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder={t('lists.listName')}
                    className="w-full p-3 bg-gray-700 rounded-xl mb-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseCreateForm}
                      className="flex-1 bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-xl transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleCreateList}
                      disabled={!newListName.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-xl transition-colors"
                    >
                      {t('lists.create')}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AddToListMenu; 