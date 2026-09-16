export type RecordType = "journal" | "note" | "review";

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
  recordUrl?: string;
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

/** An existing journal or note, identified by the exact path returned by a read tool. */
export interface RecordEditInput {
  path: string;
  /** Appending is an update that preserves existing content; replace edits one exact passage. */
  mode: "append" | "replace";
  content: string;
  /** Required for replace; must be a unique exact passage from the current record. */
  oldText?: string | undefined;
}

export interface RecordEditResult extends Record<string, unknown> {
  path: string;
  action: "appended" | "updated";
  recordUrl?: string;
}

export interface SaveReviewInput {
  date: string;
  from: string;
  to: string;
  title: string;
  keyword: string;
  content: string;
  sourcePaths: string[];
}

export interface RecordsStore {
  saveReview(input: SaveReviewInput): Promise<{ path: string; action: "created" }>;

  /** Creates a journal or appends a new fragment to the journal for its date. */
  captureJournal(input: CaptureJournalInput): Promise<CaptureResult>;

  /** Creates a note, never silently overwriting a path collision. */
  captureNote(input: CaptureNoteInput): Promise<CaptureResult & { action: "created" }>;

  /** Optional for legacy test doubles; configured stores implement it. */
  updateRecord?(input: RecordEditInput): Promise<RecordEditResult>;

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
