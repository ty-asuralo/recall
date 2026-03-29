// Re-exported from shared so popup scripts keep their existing import path
export {
  deleteConversationMetas,
  deleteMessagesByConversations,
  getConversationMeta,
  getConversationMetas,
  getExportDir,
  getMessagesAfterCursor,
  getMessagesByConversation,
  getStorageStats,
  saveConversationMeta,
  saveExportDir,
  saveMessage,
} from '../src/shared/idb';
