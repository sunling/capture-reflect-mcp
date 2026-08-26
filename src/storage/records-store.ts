export type RecordType = "journal" | "input";

export interface StoredRecord {
  path: string;
  date: string;
  type: RecordType;
  content: string;
}

export interface CaptureJournalInput {
  date: string;
  title: string;
  keyword: string;
  content: string;
}

export interface CaptureInputInput {
  date: string;
  title: string;
  keyword: string;
  content: string;
  tags?: string[];
  source?: string;
}

export interface RecordsStore {
  captureJournal(
    input: CaptureJournalInput,
  ): Promise<{ path: string; action: "created" | "appended" }>;

  captureInput(input: CaptureInputInput): Promise<{ path: string; action: "created" }>;

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
