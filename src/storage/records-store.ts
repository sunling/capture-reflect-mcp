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

export interface NoteEditInput {
  /** Exact path obtained from a record read, never reconstructed from a title. */
  path: string;
  /** Append an additional Markdown section, or replace a single exact passage. */
  mode: "append" | "replace";
  content: string;
  /** Required only for replace: an exact unique excerpt from the existing note. */
  oldText?: string;
}

export interface NoteEditResult {
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

  captureJournal(input: CaptureJournalInput): Promise<CaptureResult>;

  captureNote(input: CaptureNoteInput): Promise<CaptureResult & { action: "created" }>;

  /** Present on note-edit-capable stores. Older test doubles may omit it. */
  updateNote?(input: NoteEditInput): Promise<NoteEditResult>;

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
