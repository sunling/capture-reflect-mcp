import type {
  CaptureJournalInput,
  CaptureNoteInput,
  RecordsStore,
  RecordType,
} from "../storage/records-store.js";

function notConnected(): never {
  throw new Error("GitHub is not connected. Run get_github_setup_link and open the returned URL.");
}

export class UnconfiguredRecordsStore implements RecordsStore {
  captureJournal(_input: CaptureJournalInput): Promise<never> { return Promise.reject(notConnected()); }
  captureNote(_input: CaptureNoteInput): Promise<never> { return Promise.reject(notConnected()); }
  getRecords(_options: { from: string; to: string; types?: RecordType[] }): Promise<never> {
    return Promise.reject(notConnected());
  }
  searchRecords(_options: {
    query: string; from?: string; to?: string; types?: RecordType[]; limit?: number;
  }): Promise<never> { return Promise.reject(notConnected()); }
}
