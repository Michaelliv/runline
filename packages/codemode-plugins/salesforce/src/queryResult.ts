export type QueryResult = {
  totalSize?: number;
  done?: boolean;
  nextRecordsUrl?: string;
  records?: unknown[];
};

export function records(data: unknown): unknown[] {
  const value = (data as QueryResult).records;
  return Array.isArray(value) ? value : [];
}
