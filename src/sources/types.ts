export type FactStatus =
  | 'CONFIRMED'
  | 'INFERRED'
  | 'NOT_STATED'
  | 'CONFLICTING';

export type ExtractedFact<T> = {
  value: T | null;
  status: FactStatus;
  evidence?: string;
};

export type RawItem = {
  externalId: string;
  sourceUrl: string;
  roomType: string | null;
  area: string | null;
  availableFromRaw: string | null;
};

export type Observation = {
  externalId: string;
  sourceUrl: string;
  extractedFacts: {
    roomType: ExtractedFact<string>;
    area: ExtractedFact<string>;
    availableFrom: ExtractedFact<string>;
  };
};

export interface HousingSource {
  fetch(): Promise<RawItem[]>;
  parse(item: RawItem): Promise<Observation>;
}
