export type RecordType = "journal" | "note";

export interface StoredRecord {
  path: string;
  date: string;
  type: RecordType;
  content: string;
}

export interface RecordAttachment {
  data: Uint8Array;
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  alt: string;
}

export interface CaptureResult {
  path: string;
  action: "created" | "appended";
  attachmentPaths: string[];
}

export interface CaptureJournalInput {
  date: string;
  title: string;
  keyword: string;
  content: string;
  attachments?: RecordAttachment[];
}

export interface CaptureNoteInput {
  date: string;
  title: string;
  keyword: string;
  content: string;
  tags?: string[];
  source?: string;
  attachments?: RecordAttachment[];
}

export interface RecordsStore {
  captureJournal(
    input: CaptureJournalInput,
  ): Promise<CaptureResult>;

  captureNote(input: CaptureNoteInput): Promise<CaptureResult & { action: "created" }>;

  getRecords(options: {
    from: string;
    to: string;
    types?: RecordType[];
  }): Promise<StoredRecord[]>;

  searchRecords(options: {
    query: string;
    from?: string;
    to?: string;
    types?: RecordType[];
    limit?: number;
  }): Promise<Array<StoredRecord & { excerpts: string[] }>>;
}
