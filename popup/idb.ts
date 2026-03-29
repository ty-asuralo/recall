// Re-exported from shared so popup scripts keep their existing import path
export {
  deleteConversationMetas,
  deleteMessagesByConversations,
  getConversationMeta,
  getConversationMetas,
  getExportDir,
  getFavoriteMessages,
  getMessagesAfterCursor,
  getMessagesByConversation,
  getStorageStats,
  saveConversationMeta,
  saveExportDir,
  saveMessage,
  setMessageFavorite,
} from '../src/shared/idb';
