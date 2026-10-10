import { createLogger } from './logger'
import {
  parseLocalDrafts,
  serializeLocalDrafts,
  type LocalDraftRecord,
} from './localDrafts'
import {
  parsePinnedDocuments,
  serializePinnedDocuments,
  type PinnedDocumentRecord,
} from './pinnedDocuments'
import {
  parseRecentDocuments,
  serializeRecentDocuments,
  type RecentDocumentRecord,
} from './recentDocuments'

const draftsLogger = createLogger('drafts')

export const LEGACY_DRAFT_STORAGE_KEY = 'marktext-for-android:draft'
export const LOCAL_DRAFTS_STORAGE_KEY = 'marktext-for-android:drafts'
export const ANDROID_RECENT_DOCUMENTS_STORAGE_KEY =
  'marktext-for-android:recent-documents'
export const PINNED_DOCUMENTS_STORAGE_KEY = 'marktext-for-android:pinned-documents'

interface DocumentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function readStoredLocalDrafts(storage: DocumentStorage = localStorage) {
  return parseLocalDrafts(storage.getItem(LOCAL_DRAFTS_STORAGE_KEY))
}

/**
 * Writes the draft store and reports whether the payload was persisted.
 *
 * localStorage allows roughly 5 MB and most engines count string characters
 * twice, so a few 1 MB documents exhaust the origin: the draft write threw
 * QuotaExceededError and the document open that triggered it aborted. Draft
 * records are never evicted here — each one is the only durable copy of its
 * content — so a write that does not fit reports failure and leaves the
 * stored records untouched.
 */
export function writeStoredLocalDrafts(
  records: LocalDraftRecord[],
  storage: DocumentStorage = localStorage,
): boolean {
  if (records.length === 0) {
    storage.removeItem(LOCAL_DRAFTS_STORAGE_KEY)
    storage.removeItem(LEGACY_DRAFT_STORAGE_KEY)
    return true
  }

  const payload = serializeLocalDrafts(records)
  try {
    storage.setItem(LOCAL_DRAFTS_STORAGE_KEY, payload)
  } catch (error) {
    draftsLogger.warn('local drafts did not fit the storage quota; nothing was written', {
      drafts: records.length,
      characters: payload.length,
      error: String(error),
    })
    return false
  }

  storage.removeItem(LEGACY_DRAFT_STORAGE_KEY)
  return true
}

export function readLegacyDraft(storage: DocumentStorage = localStorage) {
  return storage.getItem(LEGACY_DRAFT_STORAGE_KEY)
}

export function readStoredPinnedDocuments(storage: DocumentStorage = localStorage) {
  return parsePinnedDocuments(storage.getItem(PINNED_DOCUMENTS_STORAGE_KEY))
}

export function writeStoredPinnedDocuments(
  records: PinnedDocumentRecord[],
  storage: DocumentStorage = localStorage,
) {
  if (records.length > 0) {
    storage.setItem(PINNED_DOCUMENTS_STORAGE_KEY, serializePinnedDocuments(records))
  } else {
    storage.removeItem(PINNED_DOCUMENTS_STORAGE_KEY)
  }
}

export function readStoredAndroidRecentDocuments(
  storage: DocumentStorage = localStorage,
) {
  return parseRecentDocuments(storage.getItem(ANDROID_RECENT_DOCUMENTS_STORAGE_KEY)).filter(
    record => record.kind === 'android-document',
  )
}

export function writeStoredAndroidRecentDocuments(
  records: RecentDocumentRecord[],
  protectedIds?: ReadonlySet<string>,
  storage: DocumentStorage = localStorage,
) {
  const androidDocuments = records.filter(record => record.kind === 'android-document')

  if (androidDocuments.length > 0) {
    storage.setItem(
      ANDROID_RECENT_DOCUMENTS_STORAGE_KEY,
      // Serialization re-applies the storage cap, so it needs the pinned
      // ids too — otherwise a pinned record kept by a pin-aware upsert
      // would be dropped right here on the way to disk.
      serializeRecentDocuments(androidDocuments, protectedIds),
    )
  } else {
    storage.removeItem(ANDROID_RECENT_DOCUMENTS_STORAGE_KEY)
  }

  return androidDocuments
}
